import { existsSync } from 'fs';
import { loadConfigFile, loadOptionalConfigFile } from './config.ts';

/**
 * Base type for config objects that contain arrays.
 */
type ConfigWithArray<K extends string, T> = { [key in K]: T[] };

/**
 * Loads a config file with detailed error reporting and diagnostics.
 * When the file exists, uses strict loading to surface parse errors.
 * Otherwise falls back to optional loading.
 *
 * @template K The array property key name
 * @template T The array item type
 * @param config Configuration for loading
 * @returns The extracted array from the config
 */
export function loadConfigWithDiagnostics<K extends string, T>(config: {
  primaryPath: string;
  fallbackPath: string;
  defaultValue: ConfigWithArray<K, T>;
  arrayKey: K;
  configLabel: string;
}): T[] {
  try {
    const fileExists = existsSync(config.primaryPath);
    const loadedConfig = fileExists
      ? loadConfigFile<ConfigWithArray<K, T>>(config.primaryPath)
      : loadOptionalConfigFile<ConfigWithArray<K, T>>(
          config.primaryPath,
          config.fallbackPath,
          config.defaultValue
        );

    const arrayValue = loadedConfig?.[config.arrayKey];
    const resultArray = Array.isArray(arrayValue) ? arrayValue : [];

    // Diagnostic logging when file exists but array is empty or malformed
    if (
      fileExists &&
      resultArray.length === 0 &&
      loadedConfig &&
      typeof loadedConfig === 'object'
    ) {
      const keys = Object.keys(loadedConfig);
      console.error(
        `  ✗ ${config.configLabel} parsed but "${config.arrayKey}" is empty. Top-level keys: [${keys.join(', ')}]`
      );
    }

    return resultArray as T[];
  } catch (err) {
    console.error(
      `  ✗ Failed to load ${config.configLabel}:`,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
}

/**
 * Generic config loader return type for collections with public/private split.
 */
export interface ConfigLoadResult<T> {
  items: T[];
  publicCount: number;
  privateCount: number;
}

/**
 * Loads configuration items from both public and private config files.
 *
 * @template K The array property key name
 * @template T The array item type
 * @param config Configuration for loading both public and private configs
 * @returns Combined items with counts
 */
export function loadPublicPrivateConfigs<K extends string, T>(config: {
  publicPath: string;
  publicFallback: string;
  privatePath: string;
  privateFallback: string;
  defaultValue: ConfigWithArray<K, T>;
  arrayKey: K;
  publicLabel: string;
  privateLabel: string;
}): ConfigLoadResult<T> {
  const publicItems = loadConfigWithDiagnostics<K, T>({
    primaryPath: config.publicPath,
    fallbackPath: config.publicFallback,
    defaultValue: config.defaultValue,
    arrayKey: config.arrayKey,
    configLabel: config.publicLabel,
  });

  const privateItems = loadConfigWithDiagnostics<K, T>({
    primaryPath: config.privatePath,
    fallbackPath: config.privateFallback,
    defaultValue: config.defaultValue,
    arrayKey: config.arrayKey,
    configLabel: config.privateLabel,
  });

  return {
    items: [...publicItems, ...privateItems],
    publicCount: publicItems.length,
    privateCount: privateItems.length,
  };
}
