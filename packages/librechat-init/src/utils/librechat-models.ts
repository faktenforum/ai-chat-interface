/**
 * LibreChat-compatible Agent model functions
 * Implemented directly to avoid dependency on dev/librechat in Docker container
 * Based on LibreChat's api/models/Agent.js
 */

import mongoose from 'mongoose';

// MCP delimiter constant (matching LibreChat)
const MCP_DELIMITER = '_mcp_';

/**
 * Extracts unique MCP server names from tools array
 * Tools format: "toolName_mcp_serverName" or "sys__server__sys_mcp_serverName"
 */
function extractMCPServerNames(tools: string[] | undefined): string[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const serverNames = new Set<string>();
  for (const tool of tools) {
    if (!tool || !tool.includes(MCP_DELIMITER)) {
      continue;
    }
    const parts = tool.split(MCP_DELIMITER);
    if (parts.length >= 2) {
      serverNames.add(parts[parts.length - 1]);
    }
  }
  return Array.from(serverNames);
}

/**
 * Create Agent schema matching LibreChat's schema
 */
function createAgentSchema(): mongoose.Schema {
  return new mongoose.Schema(
    {
      id: {
        type: String,
        index: true,
        unique: true,
        required: true,
      },
      name: String,
      description: String,
      instructions: String,
      avatar: {
        type: mongoose.Schema.Types.Mixed,
        default: undefined,
      },
      provider: {
        type: String,
        required: true,
      },
      model: {
        type: String,
        required: true,
      },
      model_parameters: Object,
      artifacts: String,
      access_level: Number,
      recursion_limit: Number,
      tools: {
        type: [String],
        default: undefined,
      },
      tool_kwargs: [{ type: mongoose.Schema.Types.Mixed }],
      actions: {
        type: [String],
        default: undefined,
      },
      author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      authorName: {
        type: String,
        default: undefined,
      },
      hide_sequential_outputs: Boolean,
      end_after_tools: Boolean,
      agent_ids: [String], // @deprecated
      edges: {
        type: [{ type: mongoose.Schema.Types.Mixed }],
        default: [],
      },
      isCollaborative: {
        type: Boolean,
        default: undefined,
      },
      conversation_starters: {
        type: [String],
        default: [],
      },
      tool_resources: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      projectIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'Project',
        index: true,
      },
      versions: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
      },
      category: {
        type: String,
        trim: true,
        index: true,
        default: 'general',
      },
      support_contact: {
        type: mongoose.Schema.Types.Mixed,
        default: undefined,
      },
      is_promoted: {
        type: Boolean,
        default: false,
        index: true,
      },
      mcpServerNames: {
        type: [String],
        default: [],
        index: true,
      },
    },
    {
      timestamps: true,
      strict: false, // Match LibreChat's schema behavior - allow fields not in schema
    }
  );
}

/**
 * Get or create Agent model
 * If the model already exists (e.g., from LibreChat), use it directly
 * Otherwise, create our own schema-compatible model
 */
function getAgentModel(): mongoose.Model<Record<string, unknown>> {
  // If model already exists (e.g., from LibreChat API), use it
  if (mongoose.models.Agent) {
    return mongoose.models.Agent as mongoose.Model<Record<string, unknown>>;
  }
  
  // Create our own schema-compatible model
  const schema = createAgentSchema();
  schema.index({ updatedAt: -1, _id: 1 });
  schema.index({ 'edges.to': 1 });
  return mongoose.model<Record<string, unknown>>('Agent', schema);
}

// Type definitions
export interface AgentData {
  id?: string;
  name: string;
  description?: string;
  instructions?: string;
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  tools?: string[];
  category?: string;
  conversation_starters?: string[];
  recursion_limit?: number;
  edges?: unknown[];
  projectIds?: unknown[];
  artifacts?: string;
  support_contact?: unknown;
  isCollaborative?: boolean;
  author: string | mongoose.Types.ObjectId;
  [key: string]: unknown;
}

export interface UpdateAgentOptions {
  updatingUserId?: string | mongoose.Types.ObjectId | null;
  forceVersion?: boolean;
  skipVersioning?: boolean;
}

/**
 * Check if a version is duplicate (simplified version matching LibreChat's logic)
 */
function isDuplicateVersion(
  updateData: Record<string, unknown>,
  currentVersionData: Record<string, unknown>,
  versions: unknown[]
): boolean {
  if (!versions || versions.length === 0) {
    return false;
  }

  const excludeFields = [
    '_id',
    'id',
    'createdAt',
    'updatedAt',
    'author',
    'updatedBy',
    'created_at',
    'updated_at',
    '__v',
    'versions',
    'actionsHash',
  ];

  const { $push: _$push, $pull: _$pull, $addToSet: _$addToSet, ...directUpdates } = updateData;

  if (Object.keys(directUpdates).length === 0) {
    return false;
  }

  const wouldBeVersion = { ...currentVersionData, ...directUpdates };
  const lastVersion = versions[versions.length - 1] as Record<string, unknown>;

  const allFields = new Set([...Object.keys(wouldBeVersion), ...Object.keys(lastVersion)]);
  const importantFields = Array.from(allFields).filter((field) => !excludeFields.includes(field));

  for (const field of importantFields) {
    const wouldBeValue = wouldBeVersion[field];
    const lastValue = lastVersion[field];

    if (JSON.stringify(wouldBeValue) !== JSON.stringify(lastValue)) {
      return false;
    }
  }

  return true;
}

/**
 * Create a new agent using LibreChat's createAgent logic
 */
export async function createAgent(agentData: AgentData): Promise<Record<string, unknown>> {
  const Agent = getAgentModel();
  
  // Convert author to ObjectId if it's a string
  const authorId = typeof agentData.author === 'string' 
    ? new mongoose.Types.ObjectId(agentData.author)
    : agentData.author;
  
  const { author: _author, ...versionData } = agentData;
  const timestamp = new Date();
  
  const initialAgentData = {
    ...agentData,
    author: authorId,
    versions: [
      {
        ...versionData,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    category: agentData.category || 'general',
    mcpServerNames: extractMCPServerNames(agentData.tools),
  };

  const created = await Agent.create(initialAgentData);
  return created.toObject();
}

/**
 * Update an existing agent using LibreChat's updateAgent logic
 */
export async function updateAgent(
  searchParameter: { id: string },
  updateData: Record<string, unknown>,
  options: UpdateAgentOptions = {}
): Promise<Record<string, unknown> | null> {
  const Agent = getAgentModel();
  const { updatingUserId = null, forceVersion = false, skipVersioning = false } = options;
  const mongoOptions = { new: true, upsert: false };

  const currentAgent = await Agent.findOne(searchParameter);
  if (!currentAgent) {
    return null;
  }

  const {
    __v,
    _id,
    id: __id,
    versions,
    author: _author,
    ...versionData
  } = currentAgent.toObject() as Record<string, unknown>;
  
  const { $push, $pull, $addToSet, ...directUpdates } = updateData;

  // Sync mcpServerNames when tools are updated
  if (directUpdates.tools !== undefined) {
    const mcpServerNames = extractMCPServerNames(directUpdates.tools as string[]);
    directUpdates.mcpServerNames = mcpServerNames;
  }

  const shouldCreateVersion =
    !skipVersioning &&
    (forceVersion || Object.keys(directUpdates).length > 0 || $push || $pull || $addToSet);

  if (shouldCreateVersion) {
    const duplicateVersion = isDuplicateVersion(
      directUpdates,
      versionData as Record<string, unknown>,
      (versions as unknown[]) || []
    );
    
    if (duplicateVersion && !forceVersion) {
      // No changes detected, return the current agent without creating a new version
      const agentObj = currentAgent.toObject();
      (agentObj as Record<string, unknown>).version = (versions as unknown[])?.length || 0;
      return agentObj;
    }
  }

  const versionEntry: Record<string, unknown> = {
    ...versionData,
    ...directUpdates,
    updatedAt: new Date(),
  };

  // Always store updatedBy field to track who made the change
  if (updatingUserId) {
    const userId = typeof updatingUserId === 'string' 
      ? new mongoose.Types.ObjectId(updatingUserId)
      : updatingUserId;
    versionEntry.updatedBy = userId;
  }

  // Build the MongoDB update object
  // When using $push/$pull/$addToSet, we need to use $set for direct updates
  const mongoUpdate: Record<string, unknown> = {};
  
  if (Object.keys(directUpdates).length > 0) {
    mongoUpdate.$set = directUpdates;
  }
  
  if (shouldCreateVersion) {
    mongoUpdate.$push = {
      ...($push as Record<string, unknown> || {}),
      versions: versionEntry,
    };
  }
  
  if ($pull) {
    mongoUpdate.$pull = $pull;
  }
  
  if ($addToSet) {
    mongoUpdate.$addToSet = $addToSet;
  }

  const updated = await Agent.findOneAndUpdate(searchParameter, mongoUpdate, mongoOptions).lean();
  return updated as Record<string, unknown> | null;
}

/**
 * Get an agent using LibreChat's getAgent logic
 */
export async function getAgent(searchParameter: { id: string }): Promise<Record<string, unknown> | null> {
  const Agent = getAgentModel();
  return await Agent.findOne(searchParameter).lean() as Record<string, unknown> | null;
}

/**
 * Delete an agent
 */
export async function deleteAgent(searchParameter: { id: string }): Promise<Record<string, unknown> | null> {
  const Agent = getAgentModel();
  const agent = await Agent.findOne(searchParameter);
  if (!agent) {
    return null;
  }
  
  const agentObj = agent.toObject();
  await Agent.deleteOne(searchParameter);
  return agentObj as Record<string, unknown>;
}
