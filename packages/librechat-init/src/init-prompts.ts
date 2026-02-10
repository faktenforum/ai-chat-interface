import mongoose from 'mongoose';
import { connectToMongoDB, disconnectFromMongoDB, User } from './utils/mongodb.ts';
import { loadOptionalConfigFile, getSystemUserId } from './utils/config.ts';
import {
  LibreChatAPIClient,
  type PromptGroupListEntry,
  type UpdatePromptGroupPayload,
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
 * Single prompt entry from YAML configuration.
 */
interface PromptConfig {
  name: string;
  prompt: string;
  type?: 'text' | 'chat';
  category?: string;
  oneliner?: string;
  command?: string;
}

interface PromptsConfig {
  prompts: PromptConfig[];
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
  const publicPrompts = loadOptionalConfigFile<PromptsConfig>(
    PUBLIC_PROMPTS_PATH,
    PUBLIC_PROMPTS_FALLBACK,
    { prompts: [] }
  ).prompts;

  const privatePrompts = loadOptionalConfigFile<PromptsConfig>(
    PRIVATE_PROMPTS_PATH,
    PRIVATE_PROMPTS_FALLBACK,
    { prompts: [] }
  ).prompts;

  return {
    prompts: [...publicPrompts, ...privatePrompts],
    publicCount: publicPrompts.length,
    privateCount: privatePrompts.length,
  };
}

// ============================================================================
// Processing
// ============================================================================

/**
 * Checks whether prompt group metadata needs an update.
 */
function buildMetadataUpdate(
  config: PromptConfig,
  existing: PromptGroupListEntry
): UpdatePromptGroupPayload | null {
  const updates: UpdatePromptGroupPayload = {};
  let hasChanges = false;

  if (config.name !== existing.name) {
    updates.name = config.name;
    hasChanges = true;
  }
  if ((config.category ?? '') !== (existing.category ?? '')) {
    updates.category = config.category ?? '';
    hasChanges = true;
  }
  if ((config.oneliner ?? '') !== (existing.oneliner ?? '')) {
    updates.oneliner = config.oneliner ?? '';
    hasChanges = true;
  }
  // Compare command, treating undefined/empty as equivalent
  const configCommand = config.command ?? null;
  const existingCommand = existing.command ?? null;
  if (configCommand !== existingCommand) {
    updates.command = configCommand;
    hasChanges = true;
  }

  return hasChanges ? updates : null;
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
    // Create new prompt group
    const result = await client.createPromptGroup(
      {
        prompt: { prompt: config.prompt, type: promptType },
        group: {
          name: config.name,
          category: config.category,
          oneliner: config.oneliner,
          command: config.command,
        },
      },
      systemUserId
    );
    const groupId = result.group?._id ?? result.prompt.groupId;
    console.log(`  ✓ Created prompt: ${config.name} (${groupId})`);
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
