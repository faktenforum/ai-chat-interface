import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { connectToMongoDB, disconnectFromMongoDB, User } from './utils/mongodb.ts';
import { loadOptionalConfigFile, getSystemUserId } from './utils/config.ts';
import {
  LibreChatAPIClient,
  type Agent,
  type AgentCreateParams,
  type AgentUpdateParams,
  type PermissionUpdate,
  type Principal,
} from './lib/librechat-api-client.ts';

// Configuration paths
const PUBLIC_AGENTS_PATH = '/app/data/agents.json';
const PUBLIC_AGENTS_FALLBACK = '../config/agents.json';
const PRIVATE_AGENTS_PATH = '/app/data/agents.private.json';
const PRIVATE_AGENTS_FALLBACK = '../config/agents.private.json';

interface AgentConfig {
  id?: string;
  name: string;
  description?: string;
  instructions?: string;
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  tools?: string[];
  /** MCP server names to automatically add all tools from (e.g., ["image-gen", "web-search"]) */
  mcpServers?: string[];
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

// Access role IDs (matching LibreChat's AccessRoleIds)
const ACCESS_ROLE_VIEWER = 'agent_viewer';
const ACCESS_ROLE_EDITOR = 'agent_editor';
const ACCESS_ROLE_OWNER = 'agent_owner';

// MCP constants (matching LibreChat's Constants)
const MCP_DELIMITER = '_mcp_';
const MCP_SERVER = 'sys__server__sys';

/**
 * Convert MCP server names to tool identifiers
 * Adds server marker (sys__server__sys_mcp_<serverName>) and all individual tool keys
 * @param mcpServers - Array of MCP server names
 * @param client - LibreChat API client instance
 * @param userId - User ID for API authentication
 * @returns Array of tool identifiers
 */
async function convertMCPServersToTools(
  mcpServers: string[],
  client: LibreChatAPIClient,
  userId: string
): Promise<string[]> {
  const tools: string[] = [];

  for (const serverName of mcpServers) {
    // Add the server marker (required for UI to recognize MCP server)
    tools.push(`${MCP_SERVER}${MCP_DELIMITER}${serverName}`);

    // Fetch and add all individual tools from the server
    const serverTools = await client.getMCPServerTools(serverName, userId);
    if (serverTools.length > 0) {
      tools.push(...serverTools);
    } else {
      console.warn(`  ⚠ No tools retrieved for MCP server: ${serverName}`);
    }
  }

  return tools;
}

/**
 * Build tools array from configuration, including MCP servers
 * Combines manually specified tools with automatically fetched MCP server tools
 * @param agentConfig - Agent configuration
 * @param client - LibreChat API client instance
 * @param userId - User ID for API authentication
 * @returns Combined array of tool identifiers
 */
async function buildToolsArray(
  agentConfig: AgentConfig,
  client: LibreChatAPIClient,
  userId: string
): Promise<string[]> {
  const tools: string[] = [...(agentConfig.tools || [])];

  // Add MCP server tools if specified
  if (agentConfig.mcpServers && agentConfig.mcpServers.length > 0) {
    const mcpTools = await convertMCPServersToTools(agentConfig.mcpServers, client, userId);
    tools.push(...mcpTools);
  }

  return tools;
}

/**
 * Build agent create data from configuration
 */
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
    tools: await buildToolsArray(agentConfig, client, userId),
  };

  // Add optional fields only if defined
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

/**
 * Build agent update data from configuration
 */
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

  // Add optional fields only if they are defined
  if (agentConfig.description !== undefined) updateData.description = agentConfig.description;
  if (agentConfig.instructions !== undefined) updateData.instructions = agentConfig.instructions;
  if (agentConfig.model_parameters !== undefined) {
    updateData.model_parameters = agentConfig.model_parameters;
  }
  // Build tools array including MCP servers
  updateData.tools = await buildToolsArray(agentConfig, client, userId);
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

/**
 * Build permissions update data from configuration
 */
function buildPermissions(
  agentConfig: AgentConfig,
  systemUserId: string,
  ownerUserId?: string | null
): PermissionUpdate {
  const permissions = agentConfig.permissions || {};
  const updated: Principal[] = [];

  // Owner permissions
  if (ownerUserId) {
    updated.push({
      type: 'user',
      id: ownerUserId,
      accessRoleId: ACCESS_ROLE_OWNER,
    });
  }

  // Public permissions
  if (permissions.public) {
    const publicRoleId =
      permissions.publicEdit && agentConfig.isCollaborative
        ? ACCESS_ROLE_EDITOR
        : ACCESS_ROLE_VIEWER;

    updated.push({
      type: 'public',
      id: null,
      accessRoleId: publicRoleId,
    });
  }

  return {
    updated: updated.length > 0 ? updated : undefined,
    public: permissions.public || false,
    publicAccessRoleId: permissions.public
      ? permissions.publicEdit && agentConfig.isCollaborative
        ? ACCESS_ROLE_EDITOR
        : ACCESS_ROLE_VIEWER
      : undefined,
  };
}

/**
 * Initialize agents from configuration files
 * Loads agents from agents.json and agents.private.json, creates/updates them via API
 * Handles MCP server tool discovery and automatic tool addition
 */
export async function initializeAgents(): Promise<void> {
  try {
    // Load agent configurations
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

    // Skip if no agents configured
    if (allAgents.length === 0) {
      console.log('ℹ No agents configured - skipping agent initialization');
      return;
    }

    // Initialize API client
    const apiURL = process.env.LIBRECHAT_API_URL || 'http://api:3080';
    const jwtSecret = process.env.LIBRECHAT_JWT_SECRET || process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.log('  ⚠ LIBRECHAT_JWT_SECRET not set - skipping agent initialization');
      return;
    }

    const client = new LibreChatAPIClient(apiURL, jwtSecret);

    // Check API availability (non-blocking, allows graceful degradation)
    const apiAvailable = await client.waitForAPI();

    if (!apiAvailable) {
      console.log('  ⚠ LibreChat API not available - skipping agent initialization');
      console.log('  ℹ Agents will be initialized after API is ready');
      console.log('  ℹ You can manually trigger agent initialization later');
      return;
    }

    // Connect to MongoDB to get system user
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

    // Get system user ID (required for agent creation/updates)
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
        const agentId = agentConfig.id || `agent_${nanoid()}`;

        // Check if agent exists by name
        // Note: API generates new IDs and ignores config ID, so we search by name
        // The ID in config is just a reference identifier, not the actual database ID
        let existingAgent: Agent | null = null;
        try {
          existingAgent = await client.findAgentByName(agentConfig.name, systemUserIdStr);
        } catch (getError) {
          // If findAgentByName throws an error, log it but continue to create
          console.error(
            `  ⚠ Error checking if agent "${agentConfig.name}" exists:`,
            getError instanceof Error ? getError.message : String(getError)
          );
          existingAgent = null;
        }

        let savedAgent;
        if (!existingAgent) {
          // Create new agent via API
          const createData = await buildAgentCreateData(agentConfig, client, systemUserIdStr);
          savedAgent = await client.createAgent(createData, systemUserIdStr);
          console.log(
            `  ✓ Created agent: ${agentConfig.name} (${savedAgent.id}) - model: ${savedAgent.model}, provider: ${savedAgent.provider}`
          );
          agentsCreated++;
        } else {
          // Update existing agent via API (use the actual ID from the found agent)
          const updateData = await buildAgentUpdateData(agentConfig, client, systemUserIdStr);
          savedAgent = await client.updateAgent(existingAgent.id, updateData, systemUserIdStr);
          console.log(
            `  ✓ Updated agent: ${agentConfig.name} (${existingAgent.id}) - model: ${savedAgent.model}, provider: ${savedAgent.provider}`
          );
          agentsUpdated++;
        }

        // Set permissions via API
        const permissions = agentConfig.permissions || {};

        // Determine owner user ID
        let ownerUserId: string | null = null;
        if (permissions.owner) {
          const ownerUser = await User.findOne({ email: permissions.owner });
          if (ownerUser) {
            ownerUserId = ownerUser._id.toString();
          } else {
            console.log(`  ⚠ Owner user ${permissions.owner} not found, using system user`);
            ownerUserId = systemUserIdStr;
          }
        } else {
          ownerUserId = systemUserIdStr;
        }

        // Get agent _id from saved agent (needed for permissions endpoint)
        // The API returns _id as ObjectId string, which is what the permissions endpoint expects
        const agentObjectId = savedAgent._id;
        if (!agentObjectId) {
          console.error(`  ⚠ Agent "${agentConfig.name}" missing _id, skipping permissions`);
          continue;
        }

        // Build and apply permissions
        const permissionUpdate = buildPermissions(agentConfig, systemUserIdStr, ownerUserId);

        try {
          // Use _id (ObjectId) for permissions endpoint, not the agent id
          await client.updateAgentPermissions(agentObjectId, permissionUpdate, systemUserIdStr);

          if (permissions.public) {
            const publicRoleId =
              permissions.publicEdit && agentConfig.isCollaborative
                ? ACCESS_ROLE_EDITOR
                : ACCESS_ROLE_VIEWER;
            console.log(
              `    ✓ Granted public ${publicRoleId === ACCESS_ROLE_EDITOR ? 'EDIT' : 'VIEW'} access`
            );
          }
        } catch (permissionError) {
          console.error(
            `  ⚠ Failed to set permissions for agent "${agentConfig.name}":`,
            permissionError instanceof Error ? permissionError.message : String(permissionError)
          );
          // Continue - permissions are optional, agent creation/update succeeded
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
