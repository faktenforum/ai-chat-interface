import mongoose from 'mongoose';
import { connectToMongoDB, disconnectFromMongoDB, User } from './utils/mongodb.ts';
import { loadOptionalConfigFile, getSystemUserId } from './utils/config.ts';
import {
  LibreChatAPIClient,
  type Agent,
  type AgentCreateParams,
  type AgentUpdateParams,
  type PermissionUpdate,
} from './lib/librechat-api-client.ts';
import {
  PUBLIC_AGENTS_PATH,
  PUBLIC_AGENTS_FALLBACK,
  PRIVATE_AGENTS_PATH,
  PRIVATE_AGENTS_FALLBACK,
  ACCESS_ROLE_VIEWER,
  ACCESS_ROLE_EDITOR,
  ACCESS_ROLE_OWNER,
  MCP_DELIMITER,
  MCP_SERVER,
  MCP_ALL,
  DEFAULT_API_URL,
} from './utils/constants.ts';

interface AgentConfig {
  id?: string;
  name: string;
  description?: string;
  instructions?: string;
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  tools?: string[];
  /** MCP server names. If mcpTools is omitted, all tools are loaded at runtime. */
  mcpServers?: string[];
  /** Optional: Explicit MCP tool keys (format: toolName_mcp_serverName). If specified, only these tools are enabled. */
  mcpTools?: string[];
  category?: string;
  conversation_starters?: string[];
  recursion_limit?: number;
  /** @deprecated Use ACL permissions instead - only set for backward compatibility */
  isCollaborative?: boolean;
  permissions?: {
    owner?: string;
    public?: boolean;
    publicEdit?: boolean;
  };
}

interface AgentsConfig {
  agents: AgentConfig[];
}

function convertMCPServersToTools(
  mcpServers: string[],
  explicitTools: string[] | undefined
): string[] {
  const tools: string[] = [];
  const explicitToolsSet = explicitTools ? new Set(explicitTools) : new Set<string>();

  for (const serverName of mcpServers) {
    tools.push(`${MCP_SERVER}${MCP_DELIMITER}${serverName}`);

    const serverSuffix = `${MCP_DELIMITER}${serverName}`;
    const serverExplicitTools = Array.from(explicitToolsSet).filter((tool) =>
      tool.endsWith(serverSuffix)
    );

    if (serverExplicitTools.length > 0) {
      tools.push(...serverExplicitTools);
      console.log(`    ✓ Added ${serverExplicitTools.length} explicit tool(s) for MCP server: ${serverName}`);
    } else {
      tools.push(`${MCP_ALL}${MCP_DELIMITER}${serverName}`);
      console.log(`    ✓ Added "all tools" marker for MCP server: ${serverName}`);
    }
  }

  return tools;
}

function buildToolsArray(agentConfig: AgentConfig): string[] {
  const tools: string[] = [...(agentConfig.tools || [])];

  if (agentConfig.mcpServers && agentConfig.mcpServers.length > 0) {
    const mcpTools = convertMCPServersToTools(agentConfig.mcpServers, agentConfig.mcpTools);
    tools.push(...mcpTools);
  } else if (agentConfig.mcpTools && agentConfig.mcpTools.length > 0) {
    tools.push(...agentConfig.mcpTools);
    console.log(`    ✓ Added ${agentConfig.mcpTools.length} explicit MCP tool(s)`);
  }

  return tools;
}

async function buildAgentCreateData(
  agentConfig: AgentConfig,
  client: LibreChatAPIClient,
  userId: string
): Promise<AgentCreateParams> {
  const agentData: AgentCreateParams = {
    name: agentConfig.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    category: agentConfig.category || 'general',
    support_contact: {
      name: '',
      email: '',
    },
    edges: [],
    artifacts: '',
    tools: buildToolsArray(agentConfig),
  };

  if (agentConfig.description) agentData.description = agentConfig.description;
  if (agentConfig.instructions) agentData.instructions = agentConfig.instructions;
  if (agentConfig.model_parameters) agentData.model_parameters = agentConfig.model_parameters;
  if (agentConfig.conversation_starters && agentConfig.conversation_starters.length > 0) {
    agentData.conversation_starters = agentConfig.conversation_starters;
  }
  if (agentConfig.recursion_limit !== undefined) {
    agentData.recursion_limit = agentConfig.recursion_limit;
  }

  return agentData;
}

async function buildAgentUpdateData(
  agentConfig: AgentConfig,
  client: LibreChatAPIClient,
  userId: string
): Promise<AgentUpdateParams> {
  const updateData: AgentUpdateParams = {
    name: agentConfig.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    category: agentConfig.category || 'general',
  };

  if (agentConfig.description !== undefined) updateData.description = agentConfig.description;
  if (agentConfig.instructions !== undefined) updateData.instructions = agentConfig.instructions;
  if (agentConfig.model_parameters !== undefined) {
    updateData.model_parameters = agentConfig.model_parameters;
  }
  updateData.tools = buildToolsArray(agentConfig);
  if (agentConfig.conversation_starters !== undefined) {
    updateData.conversation_starters = agentConfig.conversation_starters;
  }
  if (agentConfig.recursion_limit !== undefined) {
    updateData.recursion_limit = agentConfig.recursion_limit;
  }
  if (agentConfig.isCollaborative !== undefined) {
    updateData.isCollaborative = agentConfig.isCollaborative;
  }

  return updateData;
}

function getPublicAccessRole(
  isPublic: boolean,
  publicEdit: boolean,
  isCollaborative: boolean
): string | undefined {
  if (!isPublic) return undefined;
  return publicEdit && isCollaborative ? ACCESS_ROLE_EDITOR : ACCESS_ROLE_VIEWER;
}

function buildPermissions(
  agentConfig: AgentConfig,
  ownerUserId: string
): PermissionUpdate {
  const permissions = agentConfig.permissions || {};
  const updated: Array<{ type: 'user' | 'public'; id: string | null; accessRoleId: string }> = [];

  updated.push({
    type: 'user',
    id: ownerUserId,
    accessRoleId: ACCESS_ROLE_OWNER,
  });

  if (permissions.public) {
    const publicRoleId = getPublicAccessRole(
      permissions.public,
      permissions.publicEdit || false,
      agentConfig.isCollaborative || false
    );

    if (publicRoleId) {
      updated.push({
        type: 'public',
        id: null,
        accessRoleId: publicRoleId,
      });
    }
  }

  return {
    updated: updated.length > 0 ? updated : undefined,
    public: permissions.public || false,
    publicAccessRoleId: getPublicAccessRole(
      permissions.public || false,
      permissions.publicEdit || false,
      agentConfig.isCollaborative || false
    ),
  };
}

export async function initializeAgents(): Promise<void> {
  try {
    const publicAgents = loadOptionalConfigFile<AgentsConfig>(
      PUBLIC_AGENTS_PATH,
      PUBLIC_AGENTS_FALLBACK,
      { agents: [] }
    ).agents;

    const privateAgents = loadOptionalConfigFile<AgentsConfig>(
      PRIVATE_AGENTS_PATH,
      PRIVATE_AGENTS_FALLBACK,
      { agents: [] }
    ).agents;

    const allAgents = [...publicAgents, ...privateAgents];

    if (allAgents.length === 0) {
      console.log('ℹ No agents configured - skipping agent initialization');
      return;
    }

    const apiURL = process.env.LIBRECHAT_API_URL || DEFAULT_API_URL;
    const jwtSecret = process.env.LIBRECHAT_JWT_SECRET || process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.log('  ⚠ LIBRECHAT_JWT_SECRET not set - skipping agent initialization');
      return;
    }

    const client = new LibreChatAPIClient(apiURL, jwtSecret);
    const apiAvailable = await client.waitForAPI();

    if (!apiAvailable) {
      console.log('  ⚠ LibreChat API not available - skipping agent initialization');
      console.log('  ℹ Agents will be initialized after API is ready');
      console.log('  ℹ You can manually trigger agent initialization later');
      return;
    }

    await connectToMongoDB();

    const publicCount = publicAgents.length;
    const privateCount = privateAgents.length;
    console.log('Initializing agents from configuration...');
    if (publicCount > 0) {
      console.log(`  Loading ${publicCount} agent(s) from agents.json`);
    }
    if (privateCount > 0) {
      console.log(`  Loading ${privateCount} agent(s) from agents.private.json`);
    }

    let systemUserId: mongoose.Types.ObjectId | string | null = null;
    try {
      systemUserId = await getSystemUserId(User);
      console.log(`  Using system user ID: ${systemUserId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('No users found')) {
        console.log('  ℹ No users found in database - skipping agent initialization');
        console.log('  ℹ Agents will be initialized after first user login');
        return;
      }
      throw error;
    }

    if (!systemUserId) {
      console.log('  ℹ No system user available - skipping agent initialization');
      return;
    }

    const systemUserIdStr = systemUserId.toString();

    let agentsCreated = 0;
    let agentsUpdated = 0;
    let agentsSkipped = 0;

    for (const agentConfig of allAgents) {
      try {
        const existingAgent = await client.findAgentByName(agentConfig.name, systemUserIdStr);

        let savedAgent: Agent;
        if (!existingAgent) {
          const createData = await buildAgentCreateData(agentConfig, client, systemUserIdStr);
          savedAgent = await client.createAgent(createData, systemUserIdStr);
          console.log(
            `  ✓ Created agent: ${agentConfig.name} (${savedAgent.id}) - ${savedAgent.provider}/${savedAgent.model}`
          );
          agentsCreated++;
        } else {
          const updateData = await buildAgentUpdateData(agentConfig, client, systemUserIdStr);
          savedAgent = await client.updateAgent(existingAgent.id, updateData, systemUserIdStr);
          console.log(
            `  ✓ Updated agent: ${agentConfig.name} (${existingAgent.id}) - ${savedAgent.provider}/${savedAgent.model}`
          );
          agentsUpdated++;
        }

        const permissions = agentConfig.permissions || {};
        let ownerUserId = systemUserIdStr;

        if (permissions.owner) {
          const ownerUser = await User.findOne({ email: permissions.owner });
          if (ownerUser) {
            ownerUserId = ownerUser._id.toString();
          } else {
            console.log(`  ⚠ Owner user ${permissions.owner} not found, using system user`);
          }
        }

        const agentObjectId = savedAgent._id;
        if (!agentObjectId) {
          console.error(`  ⚠ Agent "${agentConfig.name}" missing _id, skipping permissions`);
          continue;
        }

        try {
          const permissionUpdate = buildPermissions(agentConfig, ownerUserId);
          await client.updateAgentPermissions(agentObjectId, permissionUpdate, systemUserIdStr);

          if (permissions.public) {
            const roleId = getPublicAccessRole(
              permissions.public,
              permissions.publicEdit || false,
              agentConfig.isCollaborative || false
            );
            console.log(`    ✓ Granted public ${roleId === ACCESS_ROLE_EDITOR ? 'EDIT' : 'VIEW'} access`);
          }
        } catch (permissionError) {
          console.error(
            `  ⚠ Failed to set permissions for agent "${agentConfig.name}":`,
            permissionError instanceof Error ? permissionError.message : String(permissionError)
          );
        }
      } catch (error) {
        console.error(
          `  ✗ Error processing agent ${agentConfig.name}:`,
          error instanceof Error ? error.message : String(error)
        );
        agentsSkipped++;
      }
    }

    console.log(`✓ Agent initialization completed:`);
    console.log(`  - Created: ${agentsCreated}`);
    console.log(`  - Updated: ${agentsUpdated}`);
    if (agentsSkipped > 0) {
      console.log(`  - Skipped: ${agentsSkipped}`);
    }
  } catch (error) {
    console.error('✗ Error during agent initialization:', error);
    throw error;
  } finally {
    await disconnectFromMongoDB();
  }
}
