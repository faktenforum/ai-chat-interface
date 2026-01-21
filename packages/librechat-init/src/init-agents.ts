import mongoose from 'mongoose';
import { nanoid } from 'nanoid';
import { connectToMongoDB, disconnectFromMongoDB, User, type IUser } from './utils/mongodb.ts';
import { loadOptionalConfigFile, getSystemUserId } from './utils/config.ts';
import { createAgent, updateAgent, getAgent, deleteAgent, type AgentData } from './utils/librechat-models.ts';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Set up require for accessing models (AclEntry, AccessRole)
// We'll create these schemas locally since we can't access LibreChat's in Docker
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Create schemas for AclEntry and AccessRole (needed for permissions)
// These are simplified versions matching LibreChat's structure
function createAclEntrySchema(): mongoose.Schema {
  return new mongoose.Schema({}, { strict: false, collection: 'aclentries', timestamps: true });
}

function createAccessRoleSchema(): mongoose.Schema {
  return new mongoose.Schema({}, { strict: false, collection: 'accessroles', timestamps: true });
}

function getAclEntryModel(): mongoose.Model<Record<string, unknown>> {
  if (mongoose.models.AclEntry) {
    return mongoose.models.AclEntry as mongoose.Model<Record<string, unknown>>;
  }
  return mongoose.model<Record<string, unknown>>('AclEntry', createAclEntrySchema());
}

function getAccessRoleModel(): mongoose.Model<Record<string, unknown>> {
  if (mongoose.models.AccessRole) {
    return mongoose.models.AccessRole as mongoose.Model<Record<string, unknown>>;
  }
  return mongoose.model<Record<string, unknown>>('AccessRole', createAccessRoleSchema());
}

// Helper to get models
function getModels() {
  return {
    AclEntry: getAclEntryModel(),
    AccessRole: getAccessRoleModel(),
  };
}

/**
 * Seed default access roles if they don't exist
 */
async function seedAccessRoles(): Promise<void> {
  const { AccessRole } = getModels();
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
    const { AccessRole, AclEntry } = getModels();
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
 * Simplified - versioning is now handled by LibreChat's createAgent/updateAgent functions
 */
function buildAgentData(agentConfig: AgentConfig, authorId: string): AgentData {
  const agentData: AgentData = {
    id: agentConfig.id || `agent_${nanoid()}`,
    name: agentConfig.name,
    provider: agentConfig.provider,
    model: agentConfig.model,
    author: authorId, // Pass as string, will be converted to ObjectId by wrapper
    category: agentConfig.category || 'general',
    // Required fields that LibreChat expects
    support_contact: {
      name: '',
      email: '',
    },
    // Default empty arrays for fields that may be set later
    edges: [],
    projectIds: [],
    // Set artifacts to empty string (will be set via capabilities if needed)
    artifacts: '',
  };
  
  // Add optional fields only if defined
  if (agentConfig.description) agentData.description = agentConfig.description;
  if (agentConfig.instructions) agentData.instructions = agentConfig.instructions;
  if (agentConfig.model_parameters) agentData.model_parameters = agentConfig.model_parameters;
  if (agentConfig.tools && agentConfig.tools.length > 0) {
    agentData.tools = agentConfig.tools;
    // Note: mcpServerNames will be extracted automatically by LibreChat's createAgent/updateAgent
  } else {
    agentData.tools = [];
  }
  // conversation_starters: Supported in schema and displayed in chat, but not editable in Agent UI
  if (agentConfig.conversation_starters && agentConfig.conversation_starters.length > 0) {
    agentData.conversation_starters = agentConfig.conversation_starters;
  } else {
    agentData.conversation_starters = [];
  }
  if (agentConfig.recursion_limit !== undefined) agentData.recursion_limit = agentConfig.recursion_limit;
  
  // Deprecated fields - only set if explicitly provided (for backward compatibility)
  if (agentConfig.isCollaborative !== undefined) {
    agentData.isCollaborative = agentConfig.isCollaborative;
  }
  
  return agentData;
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

    // Try to get system user ID, but skip agent initialization if no users exist yet
    let systemUserId: mongoose.Types.ObjectId | string | null = null;
    try {
      systemUserId = await getSystemUserId(User);
      console.log(`  Using system user ID: ${systemUserId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('No users found')) {
        console.log('  ℹ No users found in database - skipping agent initialization');
        console.log('  ℹ Agents will be initialized after first user login');
        // Connection will be closed in finally block
        return;
      }
      throw error;
    }
    
    if (!systemUserId) {
      console.log('  ℹ No system user available - skipping agent initialization');
      // Connection will be closed in finally block
      return;
    }

    let agentsCreated = 0;
    let agentsUpdated = 0;
    let agentsSkipped = 0;

    for (const agentConfig of allAgents) {
      try {
        const agentId = agentConfig.id || `agent_${nanoid()}`;
        const { AclEntry } = getModels();
        
        // Check if agent exists
        const existingAgent = await getAgent({ id: agentId });
        
        // If agent exists but has critical issues (e.g., missing model), delete and recreate
        if (existingAgent) {
          const hasCriticalIssues = !existingAgent.model || 
            !existingAgent.provider ||
            !existingAgent.versions || 
            !Array.isArray(existingAgent.versions) ||
            existingAgent.versions.length === 0 ||
            !(existingAgent.versions[existingAgent.versions.length - 1] as Record<string, unknown>)?.model ||
            !(existingAgent.versions[existingAgent.versions.length - 1] as Record<string, unknown>)?.provider;
          
          if (hasCriticalIssues) {
            console.log(`  ⚠ Agent ${agentId} has critical issues, deleting and recreating...`);
            console.log(`     Current state: model=${existingAgent.model}, provider=${existingAgent.provider}`);
            await deleteAgent({ id: agentId });
            // Also delete ACL entries for this agent
            const { AclEntry } = getModels();
            await AclEntry.deleteMany({ 
              resourceType: 'agent', 
              resourceId: existingAgent._id 
            });
            console.log(`  ✓ Deleted problematic agent ${agentId}, will recreate`);
            // Set existingAgent to null so it will be created fresh
            (existingAgent as unknown) = null;
          }
        }
        
        // Build agent data (simplified - versioning handled by LibreChat functions)
        const agentData = buildAgentData(agentConfig, systemUserId.toString());

        let savedAgent: Record<string, unknown>;
        if (!existingAgent || !existingAgent.model || !existingAgent.provider) {
          // Agent doesn't exist or is invalid - create new
          savedAgent = await createAgent(agentData);
          console.log(`  ✓ Created agent: ${agentConfig.name} (${agentId}) - model: ${savedAgent.model}, provider: ${savedAgent.provider}`);
          agentsCreated++;
        } else if (existingAgent) {
          // Update existing agent using LibreChat's updateAgent
          // Build update data - only include fields that should be updated
          const updateData: Record<string, unknown> = {
            name: agentData.name,
            provider: agentData.provider,
            model: agentData.model, // CRITICAL: Must be on top-level
            category: agentData.category || 'general',
          };
          
          // Add optional fields only if they are defined
          if (agentData.description !== undefined) updateData.description = agentData.description;
          if (agentData.instructions !== undefined) updateData.instructions = agentData.instructions;
          if (agentData.model_parameters !== undefined) updateData.model_parameters = agentData.model_parameters;
          if (agentData.tools !== undefined) updateData.tools = agentData.tools;
          if (agentData.conversation_starters !== undefined) updateData.conversation_starters = agentData.conversation_starters;
          if (agentData.recursion_limit !== undefined) updateData.recursion_limit = agentData.recursion_limit;
          if (agentData.edges !== undefined) updateData.edges = agentData.edges;
          if (agentData.projectIds !== undefined) updateData.projectIds = agentData.projectIds;
          if (agentData.artifacts !== undefined) updateData.artifacts = agentData.artifacts;
          if (agentData.support_contact !== undefined) updateData.support_contact = agentData.support_contact;
          if (agentData.isCollaborative !== undefined) updateData.isCollaborative = agentData.isCollaborative;
          
          // Use LibreChat's updateAgent - it handles versioning, mcpServerNames, etc.
          savedAgent = await updateAgent(
            { id: agentId },
            updateData,
            { updatingUserId: systemUserId.toString() }
          ) as Record<string, unknown>;
          
          if (!savedAgent) {
            throw new Error(`Failed to update agent ${agentId}`);
          }
          
          // Verify model is present
          if (!savedAgent.model) {
            console.error(`  ✗ ERROR: Agent ${agentId} missing model field after update!`);
            throw new Error(`Agent ${agentId} missing model field after update`);
          }
          
          console.log(`  ✓ Updated agent: ${agentConfig.name} (${agentId}) - model: ${savedAgent.model}, provider: ${savedAgent.provider}`);
          
          // Verify getAgent returns the model
          const testGetAgent = await getAgent({ id: agentId });
          if (!testGetAgent || !testGetAgent.model) {
            console.error(`  ✗ ERROR: getAgent() does not return model field for ${agentId}!`);
          } else {
            console.log(`  ✓ Verified: getAgent() returns model: ${testGetAgent.model}`);
          }
          
          agentsUpdated++;
        } else {
          // Create new agent using LibreChat's createAgent
          savedAgent = await createAgent(agentData);
          
          // Verify model is present
          if (!savedAgent.model) {
            console.error(`  ✗ ERROR: Agent ${agentId} missing model field after creation!`);
            throw new Error(`Agent ${agentId} missing model field after creation`);
          }
          
          console.log(`  ✓ Created agent: ${agentConfig.name} (${agentId}) - model: ${savedAgent.model}`);
          
          // Verify getAgent returns the model
          const testGetAgent = await getAgent({ id: agentId });
          if (!testGetAgent || !testGetAgent.model) {
            console.error(`  ✗ ERROR: getAgent() does not return model field for ${agentId}!`);
          } else {
            console.log(`  ✓ Verified: getAgent() returns model: ${testGetAgent.model}`);
          }
          
          agentsCreated++;
        }

        // Grant permissions
        const permissions = agentConfig.permissions || {};
        
        // Owner permissions
        let ownerUserId: mongoose.Types.ObjectId = typeof systemUserId === 'string' 
          ? new mongoose.Types.ObjectId(systemUserId)
          : systemUserId as mongoose.Types.ObjectId;
        if (permissions.owner) {
          const ownerUser = await User.findOne({ email: permissions.owner });
          if (ownerUser) {
            ownerUserId = ownerUser._id;
          } else {
            console.log(`  ⚠ Owner user ${permissions.owner} not found, using system user`);
          }
        }
        
        // Convert savedAgent._id to ObjectId if it's a string
        const agentObjectId = typeof savedAgent._id === 'string' 
          ? new mongoose.Types.ObjectId(savedAgent._id)
          : savedAgent._id as mongoose.Types.ObjectId;
        
        const systemUserIdObjectId = typeof systemUserId === 'string' 
          ? new mongoose.Types.ObjectId(systemUserId)
          : systemUserId as mongoose.Types.ObjectId;
        
        await grantAgentPermission(
          agentObjectId,
          'user',
          ownerUserId,
          ACCESS_ROLE_OWNER,
          systemUserIdObjectId
        );

        // Public permissions
        if (permissions.public) {
          const publicRoleId = permissions.publicEdit && agentConfig.isCollaborative
            ? ACCESS_ROLE_EDITOR
            : ACCESS_ROLE_VIEWER;
          
          await grantAgentPermission(
            agentObjectId,
            'public',
            null,
            publicRoleId,
            systemUserIdObjectId
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
