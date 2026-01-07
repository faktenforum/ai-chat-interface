#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const ROOT_DIR = process.cwd();
const BASE_CONFIG = path.join(ROOT_DIR, 'config', 'librechat.yaml');
const OVERRIDE_CONFIG = path.join(ROOT_DIR, 'config', 'librechat.prod.override.yaml');
const OUTPUT_CONFIG = path.join(ROOT_DIR, 'config', 'librechat.prod.yaml');

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            const sourceValue = source[key];
            const targetValue = result[key];

            if (
                sourceValue &&
                typeof sourceValue === 'object' &&
                !Array.isArray(sourceValue) &&
                targetValue &&
                typeof targetValue === 'object' &&
                !Array.isArray(targetValue)
            ) {
                result[key] = deepMerge(targetValue, sourceValue);
            } else {
                result[key] = sourceValue as T[Extract<keyof T, string>];
            }
        }
    }

    return result;
}

function main() {
    // Load base config
    if (!fs.existsSync(BASE_CONFIG)) {
        console.error(`❌ Error: Base config not found: ${BASE_CONFIG}`);
        process.exit(1);
    }

    const baseConfigContent = fs.readFileSync(BASE_CONFIG, 'utf-8');
    const baseConfig = yaml.load(baseConfigContent) as Record<string, any> || {};

    // Load override config (optional)
    let overrideConfig: Record<string, any> = {};
    if (!fs.existsSync(OVERRIDE_CONFIG)) {
        console.warn(`⚠️  Warning: Override config not found: ${OVERRIDE_CONFIG}`);
        console.warn('   Creating empty override file...');
        const overrideContent = `# Production-specific overrides for librechat.yaml
# This file is merged with config/librechat.yaml to create config/librechat.prod.yaml
# Only define values that differ from the base configuration

# Production: Restrict registration to allowed domains
registration:
  allowedDomains:
    - "correctiv.org"
    - "faktenforum.org"
`;
        const overrideDir = path.dirname(OVERRIDE_CONFIG);
        if (!fs.existsSync(overrideDir)) {
            fs.mkdirSync(overrideDir, { recursive: true });
        }
        fs.writeFileSync(OVERRIDE_CONFIG, overrideContent, 'utf-8');
        overrideConfig = yaml.load(overrideContent) as Record<string, any> || {};
    } else {
        const overrideContent = fs.readFileSync(OVERRIDE_CONFIG, 'utf-8');
        overrideConfig = yaml.load(overrideContent) as Record<string, any> || {};
    }

    // Merge configs
    const mergedConfig = deepMerge(baseConfig, overrideConfig);

    // Write merged config
    const outputDir = path.dirname(OUTPUT_CONFIG);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const yamlOutput = yaml.dump(mergedConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
    });

    fs.writeFileSync(OUTPUT_CONFIG, yamlOutput, 'utf-8');

    console.log('✅ Successfully merged LibreChat configs:');
    console.log(`   Base: ${BASE_CONFIG}`);
    console.log(`   Override: ${OVERRIDE_CONFIG}`);
    console.log(`   Output: ${OUTPUT_CONFIG}`);
}

main();
