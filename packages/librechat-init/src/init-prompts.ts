import mongoose from 'mongoose';
import {
  connectToMongoDB,
  disconnectFromMongoDB,
  User,
  Group,
  type IUser,
  type IGroup,
} from './utils/mongodb.ts';
import { getSystemUserId } from './utils/config.ts';
import { loadPublicPrivateConfigs } from './utils/config-loader.ts';
import {
  LibreChatAPIClient,
  type PromptGroupListEntry,
  type UpdatePromptGroupPayload,
  type Principal,
} from './lib/librechat-api-client.ts';
import {
  PUBLIC_PROMPTS_PATH,
  PUBLIC_PROMPTS_FALLBACK,
  PRIVATE_PROMPTS_PATH,
  PRIVATE_PROMPTS_FALLBACK,
  DEFAULT_API_URL,
} from './utils/constants.ts';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * User permission configuration.
 */
interface UserPermission {
  email?: string;
  name?: string;
  role: 'viewer' | 'editor' | 'owner';
}

/**
 * Group permission configuration.
 */
interface GroupPermission {
  name: string;
  role: 'viewer' | 'editor' | 'owner';
}

/**
 * Public sharing configuration.
 */
interface PublicSharing {
  enabled: boolean;
  defaultRole: 'viewer' | 'editor' | 'owner';
}

/**
 * Sharing and permission configuration.
 */
interface SharingConfig {
  users?: UserPermission[];
  groups?: GroupPermission[];
  public?: PublicSharing;
}

/**
 * Single prompt entry from YAML configuration.
 */
interface PromptConfig {
  name: string;
  prompt: string;
  type?: 'text' | 'chat';
  category?: string;
  oneliner?: string;
  command?: string;
  sharing?: SharingConfig;
}

interface PromptsConfig {
  prompts: PromptConfig[];
}

// ============================================================================
// Permission Helpers
// ============================================================================

/**
 * Maps role string to AccessRoleIds constant for prompt groups.
 */
function mapRoleToAccessRoleId(role: 'viewer' | 'editor' | 'owner'): string {
  switch (role) {
    case 'viewer':
      return 'promptGroup_viewer';
    case 'editor':
      return 'promptGroup_editor';
    case 'owner':
      return 'promptGroup_owner';
    default:
      throw new Error(`Invalid role: ${role}`);
  }
}

/**
 * Finds a user by email or name.
 * Prefers email if both are provided.
 */
async function findUserByEmailOrName(
  email?: string,
  name?: string
): Promise<IUser | null> {
  if (!email && !name) {
    return null;
  }

  try {
    // Prefer email if available (more unique)
    if (email) {
      const userByEmail = await User.findOne({
        email: email.toLowerCase().trim(),
      }).lean();
      if (userByEmail) {
        return userByEmail;
      }
    }

    // Fall back to name if email not found or not provided
    if (name) {
      const userByName = await User.findOne({
        name: name.trim(),
      }).lean();
      if (userByName) {
        return userByName;
      }
    }

    return null;
  } catch (error) {
    console.warn(
      `  ⚠ Error finding user (email: ${email}, name: ${name}):`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/**
 * Finds a group by name.
 */
async function findGroupByName(name: string): Promise<IGroup | null> {
  if (!name || name.trim().length === 0) {
    return null;
  }

  try {
    return await Group.findOne({ name: name.trim() }).lean();
  } catch (error) {
    console.warn(
      `  ⚠ Error finding group (name: ${name}):`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

// ============================================================================
// Validation
// ============================================================================

/** LibreChat command regex: lowercase alphanumeric + hyphens only. */
const COMMAND_REGEX = /^[a-z0-9-]+$/;

/**
 * Validates a single prompt config entry. Returns an error string or null.
 */
function validatePromptConfig(config: PromptConfig): string | null {
  if (!config.name || config.name.trim().length === 0) {
    return 'Missing or empty "name"';
  }
  if (!config.prompt || config.prompt.trim().length === 0) {
    return `Prompt "${config.name}": missing or empty "prompt" text`;
  }
  if (config.type && config.type !== 'text' && config.type !== 'chat') {
    return `Prompt "${config.name}": invalid type "${config.type}" (must be "text" or "chat")`;
  }
  if (config.command && !COMMAND_REGEX.test(config.command)) {
    return `Prompt "${config.name}": invalid command "${config.command}" (only lowercase a-z, 0-9, hyphens)`;
  }

  // Validate sharing configuration if present
  if (config.sharing) {
    const sharing = config.sharing;

    // Validate user permissions
    if (sharing.users) {
      for (const userPerm of sharing.users) {
        if (!userPerm.email && !userPerm.name) {
          return `Prompt "${config.name}": user permission must have either email or name`;
        }
        if (
          userPerm.role !== 'viewer' &&
          userPerm.role !== 'editor' &&
          userPerm.role !== 'owner'
        ) {
          return `Prompt "${config.name}": invalid user role "${userPerm.role}" (must be viewer, editor, or owner)`;
        }
      }
    }

    // Validate group permissions
    if (sharing.groups) {
      for (const groupPerm of sharing.groups) {
        if (!groupPerm.name || groupPerm.name.trim().length === 0) {
          return `Prompt "${config.name}": group permission must have a name`;
        }
        if (
          groupPerm.role !== 'viewer' &&
          groupPerm.role !== 'editor' &&
          groupPerm.role !== 'owner'
        ) {
          return `Prompt "${config.name}": invalid group role "${groupPerm.role}" (must be viewer, editor, or owner)`;
        }
      }
    }

    // Validate public sharing
    if (sharing.public) {
      if (typeof sharing.public.enabled !== 'boolean') {
        return `Prompt "${config.name}": public.enabled must be a boolean`;
      }
      if (
        sharing.public.enabled &&
        sharing.public.defaultRole !== 'viewer' &&
        sharing.public.defaultRole !== 'editor' &&
        sharing.public.defaultRole !== 'owner'
      ) {
        return `Prompt "${config.name}": invalid public.defaultRole "${sharing.public.defaultRole}" (must be viewer, editor, or owner)`;
      }
    }
  }

  return null;
}

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Loads prompt configurations from public and private config files.
 */
function loadPromptConfigs(): {
  prompts: PromptConfig[];
  publicCount: number;
  privateCount: number;
} {
  const result = loadPublicPrivateConfigs<'prompts', PromptConfig>({
    publicPath: PUBLIC_PROMPTS_PATH,
    publicFallback: PUBLIC_PROMPTS_FALLBACK,
    privatePath: PRIVATE_PROMPTS_PATH,
    privateFallback: PRIVATE_PROMPTS_FALLBACK,
    defaultValue: { prompts: [] },
    arrayKey: 'prompts',
    publicLabel: 'prompts.yaml',
    privateLabel: 'prompts.private.yaml',
  });

  return {
    prompts: result.items,
    publicCount: result.publicCount,
    privateCount: result.privateCount,
  };
}

// ============================================================================
// Processing
// ============================================================================

/**
 * Applies sharing permissions to a prompt group.
 * This function is non-blocking: errors are logged but don't fail prompt creation.
 */
async function applyPromptPermissions(
  groupId: string,
  sharing: SharingConfig,
  client: LibreChatAPIClient,
  systemUserId: string
): Promise<void> {
  if (!sharing) {
    return;
  }

  try {
    const principals: Principal[] = [];

    // Process user permissions
    if (sharing.users && sharing.users.length > 0) {
      for (const userPerm of sharing.users) {
        const user = await findUserByEmailOrName(userPerm.email, userPerm.name);
        if (!user) {
          console.warn(
            `  ⚠ User not found (email: ${userPerm.email}, name: ${userPerm.name}) - skipping permission`
          );
          continue;
        }

        principals.push({
          type: 'user',
          id: user._id.toString(),
          accessRoleId: mapRoleToAccessRoleId(userPerm.role),
          name: user.name || user.email,
        });
      }
    }

    // Process group permissions
    if (sharing.groups && sharing.groups.length > 0) {
      for (const groupPerm of sharing.groups) {
        const group = await findGroupByName(groupPerm.name);
        if (!group) {
          console.warn(`  ⚠ Group not found (name: ${groupPerm.name}) - skipping permission`);
          continue;
        }

        principals.push({
          type: 'group',
          id: group._id.toString(),
          accessRoleId: mapRoleToAccessRoleId(groupPerm.role),
          name: group.name,
        });
      }
    }

    // Build permission update payload
    const permissionUpdate: {
      updated?: Principal[];
      public?: boolean;
      publicAccessRoleId?: string;
    } = {};

    if (principals.length > 0) {
      permissionUpdate.updated = principals;
    }

    // Handle public sharing
    if (sharing.public && sharing.public.enabled) {
      permissionUpdate.public = true;
      permissionUpdate.publicAccessRoleId = mapRoleToAccessRoleId(sharing.public.defaultRole);
    } else if (sharing.public && !sharing.public.enabled) {
      // Explicitly disable public sharing
      permissionUpdate.public = false;
    }

    // Only call API if there are permissions to update
    if (permissionUpdate.updated || permissionUpdate.public !== undefined) {
      await client.updatePromptPermissions(groupId, permissionUpdate, systemUserId);
      if (principals.length > 0) {
        console.log(`    ✓ Applied ${principals.length} permission(s) for prompt group`);
      }
      if (permissionUpdate.public) {
        console.log(`    ✓ Enabled public sharing with role: ${sharing.public?.defaultRole}`);
      } else if (permissionUpdate.public === false) {
        console.log(`    ✓ Disabled public sharing`);
      }
    }
  } catch (error) {
    // Log error but don't fail prompt creation
    console.error(
      `  ⚠ Error applying permissions for prompt group ${groupId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Checks whether prompt group metadata needs an update.
 * When any change is detected, returns the full metadata payload (including category)
 * so the API receives all fields and persists them reliably.
 */
function buildMetadataUpdate(
  config: PromptConfig,
  existing: PromptGroupListEntry
): UpdatePromptGroupPayload | null {
  const configCategory = config.category ?? '';
  const existingCategory = existing.category ?? '';
  const configOneliner = config.oneliner ?? '';
  const existingOneliner = existing.oneliner ?? '';
  const configCommand = config.command ?? null;
  const existingCommand = existing.command ?? null;

  const hasChanges =
    config.name !== existing.name ||
    configCategory !== existingCategory ||
    configOneliner !== existingOneliner ||
    configCommand !== existingCommand;

  if (!hasChanges) {
    return null;
  }

  // Send full metadata so category and other fields are always applied
  return {
    name: config.name,
    category: configCategory,
    oneliner: configOneliner,
    command: configCommand,
  };
}

/**
 * Processes a single prompt: creates or updates it in LibreChat.
 */
async function processPrompt(
  config: PromptConfig,
  client: LibreChatAPIClient,
  systemUserId: string
): Promise<{ created: boolean; updated: boolean; skipped: boolean }> {
  const existing = await client.findPromptGroupByName(config.name, systemUserId);
  const promptType = config.type || 'text';

  if (!existing) {
    // Create new prompt group (send category explicitly so it is persisted)
    const result = await client.createPromptGroup(
      {
        prompt: { prompt: config.prompt, type: promptType },
        group: {
          name: config.name,
          category: config.category ?? '',
          oneliner: config.oneliner ?? '',
          command: config.command ?? undefined,
        },
      },
      systemUserId
    );
    const groupId = result.group?._id ?? result.prompt.groupId;
    console.log(`  ✓ Created prompt: ${config.name} (${groupId})`);

    // Apply sharing permissions if configured
    if (config.sharing) {
      await applyPromptPermissions(groupId, config.sharing, client, systemUserId);
    }

    return { created: true, updated: false, skipped: false };
  }

  // Update existing prompt group
  let didUpdate = false;

  // 1. Update metadata if changed
  const metadataUpdate = buildMetadataUpdate(config, existing);
  if (metadataUpdate) {
    await client.updatePromptGroupMetadata(existing._id, metadataUpdate, systemUserId);
    console.log(`    ✓ Updated metadata for: ${config.name}`);
    didUpdate = true;
  }

  // 2. Update production prompt text if changed
  const existingPromptText = existing.productionPrompt?.prompt ?? '';
  if (config.prompt !== existingPromptText) {
    const addResult = await client.addPromptToGroup(
      existing._id,
      { prompt: config.prompt, type: promptType },
      systemUserId
    );
    const newPromptId = addResult.prompt._id;
    await client.makePromptProduction(newPromptId, systemUserId);
    console.log(`    ✓ Updated production prompt for: ${config.name}`);
    didUpdate = true;
  }

  // 3. Apply sharing permissions if configured (always update permissions, not just on other changes)
  if (config.sharing) {
    await applyPromptPermissions(existing._id, config.sharing, client, systemUserId);
  }

  if (didUpdate) {
    console.log(`  ✓ Updated prompt: ${config.name} (${existing._id})`);
  } else {
    console.log(`  ○ No changes for prompt: ${config.name}`);
  }

  return { created: false, updated: didUpdate, skipped: !didUpdate };
}

// ============================================================================
// Main
// ============================================================================

/**
 * Initializes prompts from configuration files.
 * Creates or updates prompt groups in LibreChat.
 */
export async function initializePrompts(): Promise<void> {
  try {
    const { prompts: allPrompts, publicCount, privateCount } = loadPromptConfigs();

    if (allPrompts.length === 0) {
      console.log('ℹ No prompts configured - skipping prompt initialization');
      return;
    }

    // Validate all entries first
    for (const config of allPrompts) {
      const error = validatePromptConfig(config);
      if (error) {
        throw new Error(`Invalid prompt config: ${error}`);
      }
    }

    const apiURL = process.env.LIBRECHAT_API_URL || DEFAULT_API_URL;
    const jwtSecret = process.env.LIBRECHAT_JWT_SECRET || process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.log('  ⚠ LIBRECHAT_JWT_SECRET not set - skipping prompt initialization');
      return;
    }

    const client = new LibreChatAPIClient(apiURL, jwtSecret);
    const apiAvailable = await client.waitForAPI();

    if (!apiAvailable) {
      console.log('  ⚠ LibreChat API not available - skipping prompt initialization');
      console.log('  ℹ Prompts will be initialized after API is ready');
      return;
    }

    await connectToMongoDB();

    console.log('Initializing prompts from configuration...');
    if (publicCount > 0) {
      console.log(`  Loading ${publicCount} prompt(s) from prompts.yaml`);
    }
    if (privateCount > 0) {
      console.log(`  Loading ${privateCount} prompt(s) from prompts.private.yaml`);
    }

    let systemUserId: mongoose.Types.ObjectId | string | null = null;
    try {
      systemUserId = await getSystemUserId(User);
      console.log(`  Using system user ID: ${systemUserId}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('No users found')) {
        console.log('  ℹ No users found in database - skipping prompt initialization');
        console.log('  ℹ Prompts will be initialized after first user login');
        return;
      }
      throw error;
    }

    if (!systemUserId) {
      console.log('  ℹ No system user available - skipping prompt initialization');
      return;
    }

    const systemUserIdStr = systemUserId.toString();
    const stats = { created: 0, updated: 0, skipped: 0 };

    for (const promptConfig of allPrompts) {
      try {
        const result = await processPrompt(promptConfig, client, systemUserIdStr);
        stats.created += result.created ? 1 : 0;
        stats.updated += result.updated ? 1 : 0;
        stats.skipped += result.skipped ? 1 : 0;
      } catch (error) {
        console.error(
          `  ✗ Error processing prompt ${promptConfig.name}:`,
          error instanceof Error ? error.message : String(error)
        );
        stats.skipped++;
      }
    }

    console.log(`✓ Prompt initialization completed:`);
    console.log(`  - Created: ${stats.created}`);
    console.log(`  - Updated: ${stats.updated}`);
    if (stats.skipped > 0) {
      console.log(`  - Skipped: ${stats.skipped}`);
    }
  } catch (error) {
    console.error('✗ Error during prompt initialization:', error);
    throw error;
  } finally {
    await disconnectFromMongoDB();
  }
}
