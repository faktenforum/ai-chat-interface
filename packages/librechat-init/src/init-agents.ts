import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { connectToMongoDB, disconnectFromMongoDB, User, type IUser } from './utils/mongodb.ts';
import { loadConfigFile, loadOptionalConfigFile, getSystemUserId } from './utils/config.ts';

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
  category?: string;
  conversation_starters?: string[];
  recursion_limit?: number;
  access_level?: number;
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

// Access role IDs
const ACCESS_ROLE_VIEWER = 'agent_viewer';
const ACCESS_ROLE_EDITOR = 'agent_editor';
const ACCESS_ROLE_OWNER = 'agent_owner';

// Default access roles
const DEFAULT_ACCESS_ROLES = [
  {
    accessRoleId: ACCESS_ROLE_VIEWER,
    name: 'com_ui_role_viewer',
    description: 'com_ui_role_viewer_desc',
    resourceType: 'agent',
    permBits: 1, // VIEWER = 1
  },
  {
    accessRoleId: ACCESS_ROLE_EDITOR,
    name: 'com_ui_role_editor',
    description: 'com_ui_role_editor_desc',
    resourceType: 'agent',
    permBits: 3, // VIEWER + EDITOR = 3
  },
  {
    accessRoleId: ACCESS_ROLE_OWNER,
    name: 'com_ui_role_owner',
    description: 'com_ui_role_owner_desc',
    resourceType: 'agent',
    permBits: 7, // VIEWER + EDITOR + OWNER = 7
  },
] as const;

// Mongoose schemas
const agentSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
}, { strict: false, collection: 'agents' });
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

const aclEntrySchema = new mongoose.Schema({}, { strict: false, collection: 'aclentries' });
const AclEntry = mongoose.models.AclEntry || mongoose.model('AclEntry', aclEntrySchema);

const accessRoleSchema = new mongoose.Schema({}, { strict: false, collection: 'accessroles' });
const AccessRole = mongoose.models.AccessRole || mongoose.model('AccessRole', accessRoleSchema);

/**
 * Seed default access roles if they don't exist
 */
async function seedAccessRoles(): Promise<void> {
  for (const roleData of DEFAULT_ACCESS_ROLES) {
    const existingRole = await AccessRole.findOne({ accessRoleId: roleData.accessRoleId });
    if (!existingRole) {
      await AccessRole.create(roleData);
      console.log(`  ✓ Created access role: ${roleData.accessRoleId}`);
    }
  }
}

/**
 * Grant permission to an agent
 */
async function grantAgentPermission(
  agentId: mongoose.Types.ObjectId,
  principalType: 'user' | 'public',
  principalId: mongoose.Types.ObjectId | null,
  accessRoleId: string,
  grantedBy: mongoose.Types.ObjectId
): Promise<void> {
  try {
    const role = await AccessRole.findOne({ accessRoleId });
    if (!role) {
      throw new Error(`Access role ${accessRoleId} not found`);
    }
    
    const existingEntry = await AclEntry.findOne({
      principalType,
      principalId: principalId || null,
      resourceType: 'agent',
      resourceId: agentId,
    });
    
    const permissionData = {
      permBits: role.permBits,
      roleId: role._id,
      grantedBy,
      updatedAt: new Date(),
    };
    
    if (existingEntry) {
      Object.assign(existingEntry, permissionData);
      await existingEntry.save();
    } else {
      await AclEntry.create({
        principalType,
        principalId: principalId || null,
        resourceType: 'agent',
        resourceId: agentId,
        ...permissionData,
        createdAt: new Date(),
      });
    }
  } catch (error) {
    console.error(`  ⚠ Failed to grant permission: ${error instanceof Error ? error.message : String(error)}`);
    // Don't throw - permissions are optional
  }
}

/**
 * Build agent data object from configuration
 */
function buildAgentData(agentConfig: AgentConfig, authorId: mongoose.Types.ObjectId, timestamp: Date): Record<string, unknown> {
  const agentData: Record<string, unknown> = {
    id: agentConfig.id || `agent_${nanoid()}`,
    name: agentConfig.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    author: authorId,
    category: agentConfig.category || 'general',
    isCollaborative: agentConfig.isCollaborative || false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  
  // Add optional fields only if defined
  if (agentConfig.description) agentData.description = agentConfig.description;
  if (agentConfig.instructions) agentData.instructions = agentConfig.instructions;
  if (agentConfig.model_parameters) agentData.model_parameters = agentConfig.model_parameters;
  if (agentConfig.tools && agentConfig.tools.length > 0) agentData.tools = agentConfig.tools;
  if (agentConfig.conversation_starters && agentConfig.conversation_starters.length > 0) {
    agentData.conversation_starters = agentConfig.conversation_starters;
  }
  if (agentConfig.recursion_limit !== undefined) agentData.recursion_limit = agentConfig.recursion_limit;
  if (agentConfig.access_level !== undefined) agentData.access_level = agentConfig.access_level;
  
  return agentData;
}

/**
 * Build version data from agent data (without author)
 */
function buildVersionData(agentData: Record<string, unknown>): Record<string, unknown> {
  const versionData = { ...agentData };
  delete versionData.author;
  delete versionData.id;
  return versionData;
}

export async function initializeAgents(): Promise<void> {
  try {
    // Load configurations
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

    await connectToMongoDB();

    // Seed access roles first (required for permissions)
    console.log('Seeding access roles...');
    await seedAccessRoles();

    const publicCount = publicAgents.length;
    const privateCount = privateAgents.length;
    console.log('Initializing agents from configuration...');
    if (publicCount > 0) {
      console.log(`  Loading ${publicCount} agent(s) from agents.json`);
    }
    if (privateCount > 0) {
      console.log(`  Loading ${privateCount} agent(s) from agents.private.json`);
    }

    const systemUserId = await getSystemUserId(User);
    console.log(`  Using system user ID: ${systemUserId}`);

    let agentsCreated = 0;
    let agentsUpdated = 0;
    let agentsSkipped = 0;

    for (const agentConfig of allAgents) {
      try {
        const agentId = agentConfig.id || `agent_${nanoid()}`;
        const existingAgent = await Agent.findOne({ id: agentId });
        const timestamp = new Date();
        
        const agentData = buildAgentData(agentConfig, systemUserId, timestamp);
        const versionData = buildVersionData(agentData);
        agentData.versions = [versionData];

        let savedAgent;
        if (existingAgent) {
          Object.assign(existingAgent, agentData);
          await existingAgent.save();
          savedAgent = existingAgent.toObject();
          console.log(`  ✓ Updated agent: ${agentConfig.name} (${agentId})`);
          agentsUpdated++;
        } else {
          const createdAgent = await Agent.create(agentData);
          savedAgent = createdAgent.toObject();
          console.log(`  ✓ Created agent: ${agentConfig.name} (${agentId})`);
          agentsCreated++;
        }

        // Grant permissions
        const permissions = agentConfig.permissions || {};
        
        // Owner permissions
        let ownerUserId = systemUserId;
        if (permissions.owner) {
          const ownerUser = await User.findOne({ email: permissions.owner });
          if (ownerUser) {
            ownerUserId = ownerUser._id;
          } else {
            console.log(`  ⚠ Owner user ${permissions.owner} not found, using system user`);
          }
        }
        
        await grantAgentPermission(
          savedAgent._id,
          'user',
          ownerUserId,
          ACCESS_ROLE_OWNER,
          systemUserId
        );

        // Public permissions
        if (permissions.public) {
          const publicRoleId = permissions.publicEdit && agentConfig.isCollaborative
            ? ACCESS_ROLE_EDITOR
            : ACCESS_ROLE_VIEWER;
          
          await grantAgentPermission(
            savedAgent._id,
            'public',
            null,
            publicRoleId,
            systemUserId
          );
          
          console.log(`    ✓ Granted public ${publicRoleId === ACCESS_ROLE_EDITOR ? 'EDIT' : 'VIEW'} access`);
        }

      } catch (error) {
        console.error(`  ✗ Error processing agent ${agentConfig.name}:`, error instanceof Error ? error.message : String(error));
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
