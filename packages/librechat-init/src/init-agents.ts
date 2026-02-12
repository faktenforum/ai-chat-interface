import mongoose from 'mongoose';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
  CONFIG_TARGET,
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

/**
 * Agent configuration from JSON files.
 */
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
  /** Config IDs of agents this agent can hand off to (resolved to edges with edgeType: 'handoff') */
  handoffs?: HandoffTarget[];
  /** Config IDs of agents for sequential chain / Mixture-of-Agents (resolved to agent_ids) */
  chain?: string[];
}

/** A handoff target: either a plain config ID or an object with metadata */
type HandoffTarget = string | {
  agent: string;
  /** Tool description shown to the LLM (helps it decide when to hand off) */
  description?: string;
  /** Parameter description for passthrough content (enables context transfer to target agent) */
  prompt?: string;
  /** Parameter name for passthrough content (default: "instructions") */
  promptKey?: string;
};

interface AgentsConfig {
  agents: AgentConfig[];
}

/**
 * Converts MCP server names to LibreChat tool format.
 * If explicit tools are provided, uses those; otherwise uses "all tools" marker.
 */
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

/**
 * Builds the complete tools array for an agent, combining regular tools and MCP tools.
 */
function buildToolsArray(agentConfig: AgentConfig): string[] {
  const tools: string[] = [...(agentConfig.tools || [])];

  const mcpServers = agentConfig.mcpServers;
  const mcpTools = agentConfig.mcpTools;
  if (mcpServers && mcpServers.length > 0) {
    const converted = convertMCPServersToTools(mcpServers, mcpTools);
    tools.push(...converted);
  } else if (mcpTools && mcpTools.length > 0) {
    tools.push(...mcpTools);
    console.log(`    ✓ Added ${mcpTools.length} explicit MCP tool(s)`);
  }

  return tools;
}

/**
 * Builds agent creation payload from configuration.
 */
function buildAgentCreateData(agentConfig: AgentConfig): AgentCreateParams {
  return {
    name: agentConfig.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    category: agentConfig.category || 'general',
    description: agentConfig.description,
    instructions: agentConfig.instructions,
    model_parameters: agentConfig.model_parameters,
    tools: buildToolsArray(agentConfig),
    conversation_starters: agentConfig.conversation_starters,
    recursion_limit: agentConfig.recursion_limit,
    support_contact: { name: '', email: '' },
    edges: [],
    artifacts: '',
  };
}

/**
 * Builds agent update payload from configuration.
 */
function buildAgentUpdateData(agentConfig: AgentConfig): AgentUpdateParams {
  return {
    name: agentConfig.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    category: agentConfig.category || 'general',
    description: agentConfig.description,
    instructions: agentConfig.instructions,
    model_parameters: agentConfig.model_parameters,
    tools: buildToolsArray(agentConfig),
    conversation_starters: agentConfig.conversation_starters,
    recursion_limit: agentConfig.recursion_limit,
    isCollaborative: agentConfig.isCollaborative,
    // Clear edges/agent_ids in pass 1; pass 2 sets resolved values (YAML is source of truth)
    edges: [],
    agent_ids: [],
  };
}

/**
 * Determines the public access role based on permissions.
 */
function getPublicAccessRole(
  isPublic: boolean,
  publicEdit: boolean,
  isCollaborative: boolean
): string | undefined {
  if (!isPublic) return undefined;
  return publicEdit && isCollaborative ? ACCESS_ROLE_EDITOR : ACCESS_ROLE_VIEWER;
}

/**
 * Builds permission update payload from agent configuration.
 */
function buildPermissions(agentConfig: AgentConfig, ownerUserId: string): PermissionUpdate {
  const permissions = agentConfig.permissions || {};
  const isPublic = permissions.public || false;
  const publicEdit = permissions.publicEdit || false;
  const isCollaborative = agentConfig.isCollaborative || false;
  const publicRoleId = getPublicAccessRole(isPublic, publicEdit, isCollaborative);

  const updated: Array<{ type: 'user' | 'public'; id: string | null; accessRoleId: string }> = [
    { type: 'user', id: ownerUserId, accessRoleId: ACCESS_ROLE_OWNER },
  ];

  if (isPublic && publicRoleId) {
    updated.push({ type: 'public', id: null, accessRoleId: publicRoleId });
  }

  return {
    updated: updated.length > 0 ? updated : undefined,
    public: isPublic,
    publicAccessRoleId: publicRoleId,
  };
}

/**
 * Loads agent configurations from public and private config files.
 * Returns both the agents array and counts for logging.
 */
function loadAgentConfigs(): { agents: AgentConfig[]; publicCount: number; privateCount: number } {
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

  return {
    agents: [...publicAgents, ...privateAgents],
    publicCount: publicAgents.length,
    privateCount: privateAgents.length,
  };
}

/**
 * Resolves the owner user ID from agent configuration or falls back to system user.
 */
async function resolveOwnerUserId(
  agentConfig: AgentConfig,
  systemUserId: string
): Promise<string> {
  const ownerEmail = agentConfig.permissions?.owner;
  if (!ownerEmail) return systemUserId;

  const ownerUser = await User.findOne({ email: ownerEmail });
  if (ownerUser) {
    return ownerUser._id.toString();
  }

  console.log(`  ⚠ Owner user ${ownerEmail} not found, using system user`);
  return systemUserId;
}

/**
 * Processes a single agent: creates or updates it and sets permissions.
 * Returns the LibreChat agent ID for use in pass 2 (handoff/chain resolution).
 */
async function processAgent(
  agentConfig: AgentConfig,
  client: LibreChatAPIClient,
  systemUserId: string
): Promise<{ created: boolean; updated: boolean; skipped: boolean; agentId: string | null }> {
  const existingAgent = await client.findAgentByName(agentConfig.name, systemUserId);

  let savedAgent: Agent;
  const isNew = !existingAgent;

  if (isNew) {
    const createData = buildAgentCreateData(agentConfig);
    savedAgent = await client.createAgent(createData, systemUserId);
    console.log(
      `  ✓ Created agent: ${agentConfig.name} (${savedAgent.id}) - ${savedAgent.provider}/${savedAgent.model}`
    );
  } else {
    const updateData = buildAgentUpdateData(agentConfig);
    savedAgent = await client.updateAgent(existingAgent.id, updateData, systemUserId);
    console.log(
      `  ✓ Updated agent: ${agentConfig.name} (${existingAgent.id}) - ${savedAgent.provider}/${savedAgent.model}`
    );
  }

  const agentObjectId = savedAgent._id;
  if (!agentObjectId) {
    console.error(`  ⚠ Agent "${agentConfig.name}" missing _id, skipping permissions`);
    return { created: isNew, updated: !isNew, skipped: false, agentId: savedAgent.id || null };
  }

  try {
    const ownerUserId = await resolveOwnerUserId(agentConfig, systemUserId);
    const permissionUpdate = buildPermissions(agentConfig, ownerUserId);
    await client.updateAgentPermissions(agentObjectId, permissionUpdate, systemUserId);

    if (agentConfig.permissions?.public) {
      const roleId = getPublicAccessRole(
        agentConfig.permissions.public,
        agentConfig.permissions.publicEdit || false,
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

  return { created: isNew, updated: !isNew, skipped: false, agentId: savedAgent.id || null };
}

/** Edge structure for the LibreChat API (handoff with optional metadata) */
interface HandoffEdge {
  from: string;
  to: string;
  edgeType: 'handoff';
  description?: string;
  prompt?: string;
  promptKey?: string;
}

/**
 * Resolves handoff and chain config IDs to LibreChat agent IDs.
 * Supports both simple string IDs and rich objects with description/prompt.
 * Returns the edges and agent_ids arrays ready for the API update.
 */
function resolveAgentReferences(
  agentConfig: AgentConfig,
  ownAgentId: string,
  idMap: Map<string, string>
): { edges: HandoffEdge[]; agent_ids: string[] } {
  const edges: HandoffEdge[] = [];
  const agent_ids: string[] = [];

  // Resolve handoffs → edges
  if (agentConfig.handoffs) {
    for (const target of agentConfig.handoffs) {
      const configId = typeof target === 'string' ? target : target.agent;
      const description = typeof target === 'string' ? undefined : target.description;
      const prompt = typeof target === 'string' ? undefined : target.prompt;
      const promptKey = typeof target === 'string' ? undefined : target.promptKey;

      const targetId = idMap.get(configId);
      if (targetId) {
        const edge: HandoffEdge = { from: ownAgentId, to: targetId, edgeType: 'handoff' };
        if (description) edge.description = description;
        if (prompt) edge.prompt = prompt;
        if (promptKey) edge.promptKey = promptKey;
        edges.push(edge);
      } else {
        console.log(`    ⚠ Handoff target "${configId}" not found in config ID map, skipping`);
      }
    }
  }

  // Resolve chain → agent_ids
  if (agentConfig.chain) {
    for (const configId of agentConfig.chain) {
      const targetId = idMap.get(configId);
      if (targetId) {
        agent_ids.push(targetId);
      } else {
        console.log(`    ⚠ Chain target "${configId}" not found in config ID map, skipping`);
      }
    }
  }

  return { edges, agent_ids };
}

/**
 * Replaces config IDs in modelSpecs preset.agent_id with real API agent IDs in the runtime config.
 * Required so the client's agentsMap filter matches and Assistenten group / default spec work.
 */
function patchModelSpecAgentIds(configPath: string, idMap: Map<string, string>): void {
  if (!existsSync(configPath)) {
    console.log(`  ℹ Config file not found (${configPath}), skipping modelSpec agent_id patch`);
    return;
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = parseYaml(raw) as { modelSpecs?: { list?: Array<{ preset?: { agent_id?: string } }> } };
    const list = config?.modelSpecs?.list;
    if (!list?.length) {
      return;
    }
    let patched = 0;
    for (const spec of list) {
      const aid = spec.preset?.agent_id;
      if (aid && idMap.has(aid)) {
        spec.preset!.agent_id = idMap.get(aid)!;
        patched++;
      }
    }
    if (patched > 0) {
      writeFileSync(configPath, stringifyYaml(config), 'utf-8');
      console.log(`  ✓ Patched ${patched} modelSpec(s) with real agent IDs. Restart the API to apply.`);
    }
  } catch (err) {
    console.error(
      '  ⚠ Failed to patch config agent IDs:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Initializes agents from configuration files.
 * Creates or updates agents in LibreChat and sets their permissions.
 */
export async function initializeAgents(): Promise<void> {
  try {
    const { agents: allAgents, publicCount, privateCount } = loadAgentConfigs();

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
      return;
    }

    await connectToMongoDB();

    console.log('Initializing agents from configuration...');
    if (publicCount > 0) {
      console.log(`  Loading ${publicCount} agent(s) from agents.yaml`);
    }
    if (privateCount > 0) {
      console.log(`  Loading ${privateCount} agent(s) from agents.private.yaml`);
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
    const stats = { created: 0, updated: 0, skipped: 0 };

    // Pass 1: Create/update all agents and build config ID → LibreChat ID mapping
    const idMap = new Map<string, string>();

    for (const agentConfig of allAgents) {
      try {
        const result = await processAgent(agentConfig, client, systemUserIdStr);
        stats.created += result.created ? 1 : 0;
        stats.updated += result.updated ? 1 : 0;
        stats.skipped += result.skipped ? 1 : 0;

        if (result.agentId && agentConfig.id) {
          idMap.set(agentConfig.id, result.agentId);
        }
      } catch (error) {
        console.error(
          `  ✗ Error processing agent ${agentConfig.name}:`,
          error instanceof Error ? error.message : String(error)
        );
        stats.skipped++;
      }
    }

    // Pass 2: Resolve and set handoffs (edges) and chains (agent_ids)
    const agentsWithRefs = allAgents.filter(
      (a) => a.id && ((a.handoffs && a.handoffs.length > 0) || (a.chain && a.chain.length > 0))
    );

    if (agentsWithRefs.length > 0) {
      console.log(`  Resolving handoffs/chains for ${agentsWithRefs.length} agent(s)...`);

      for (const agentConfig of agentsWithRefs) {
        const ownId = idMap.get(agentConfig.id!);
        if (!ownId) {
          console.log(`  ⚠ Agent "${agentConfig.name}" has no resolved ID, skipping handoff resolution`);
          continue;
        }

        try {
          const { edges, agent_ids } = resolveAgentReferences(agentConfig, ownId, idMap);

          const updatePayload: AgentUpdateParams = {};
          if (edges.length > 0) {
            updatePayload.edges = edges;
          }
          if (agent_ids.length > 0) {
            updatePayload.agent_ids = agent_ids;
          }

          if (edges.length > 0 || agent_ids.length > 0) {
            await client.updateAgent(ownId, updatePayload, systemUserIdStr);
            const parts: string[] = [];
            if (edges.length > 0) parts.push(`${edges.length} handoff(s)`);
            if (agent_ids.length > 0) parts.push(`${agent_ids.length} chain agent(s)`);
            console.log(`    ✓ ${agentConfig.name}: set ${parts.join(' + ')}`);
          }
        } catch (error) {
          console.error(
            `  ⚠ Failed to set handoffs/chain for "${agentConfig.name}":`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    console.log(`✓ Agent initialization completed:`);
    console.log(`  - Created: ${stats.created}`);
    console.log(`  - Updated: ${stats.updated}`);
    if (stats.skipped > 0) {
      console.log(`  - Skipped: ${stats.skipped}`);
    }
    if (agentsWithRefs.length > 0) {
      console.log(`  - Handoffs/chains resolved: ${agentsWithRefs.length}`);
    }

    if (idMap.size > 0) {
      patchModelSpecAgentIds(CONFIG_TARGET, idMap);
    }
  } catch (error) {
    console.error('✗ Error during agent initialization:', error);
    throw error;
  } finally {
    await disconnectFromMongoDB();
  }
}
