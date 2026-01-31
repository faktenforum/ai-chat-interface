#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { input, password } from '@inquirer/prompts';
import dotenv from 'dotenv';

const ROOT_DIR = process.cwd();
const LOCAL_ENV_FILE = path.join(ROOT_DIR, '.env.local');
const PROD_ENV_FILE = path.join(ROOT_DIR, '.env.prod');
const DEV_ENV_FILE = path.join(ROOT_DIR, '.env.dev');
const LOCAL_EXAMPLE_FILE = path.join(ROOT_DIR, 'env.local.example');
const PROD_EXAMPLE_FILE = path.join(ROOT_DIR, 'env.prod.example');
const DEV_EXAMPLE_FILE = path.join(ROOT_DIR, 'env.dev.example');

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random hex string
 */
const genSecret = (length: number = 32): string => crypto.randomBytes(length).toString('hex');

/**
 * Generate a random base64 string
 */
const genBase64Secret = (length: number = 32): string => crypto.randomBytes(length).toString('base64');

/**
 * Generate a secure password meeting common requirements:
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - Minimum length: 8 characters
 */
const genPassword = (length: number = 16): string => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const all = uppercase + lowercase + numbers;
    
    // Ensure at least one of each required character type
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    
    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
        password += all[Math.floor(Math.random() * all.length)];
    }
    
    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
};

/**
 * Generate a random username with optional prefix
 */
const genUsername = (prefix: string = 'admin'): string => {
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${randomSuffix}`;
};

/**
 * Check if a value contains variable expansions (e.g., ${VAR_NAME})
 */
const containsVariableExpansion = (value: string): boolean => {
    return /\$\{[^}]+\}/.test(value);
};

/**
 * Extract all variable names from expansions in a value
 * Returns array of variable names found (e.g., "${VAR1}/${VAR2}" -> ["VAR1", "VAR2"])
 */
const extractVariableNames = (value: string): string[] => {
    const matches = value.matchAll(/\$\{([^}]+)\}/g);
    return Array.from(matches, m => m[1]);
};

// ============================================================================
// Configuration
// ============================================================================

/**
 * Variables that should be automatically generated if missing
 */
const AUTO_GENERATED: Record<string, () => string> = {
    'LIBRECHAT_SESSION_SECRET': () => genSecret(32),
    'LIBRECHAT_JWT_SECRET': () => genSecret(32),
    'LIBRECHAT_JWT_REFRESH_SECRET': () => genSecret(32),
    'LIBRECHAT_CREDS_KEY': () => genSecret(16), // 32 hex chars = 16 bytes
    'LIBRECHAT_CREDS_IV': () => genSecret(8),   // 16 hex chars = 8 bytes
    'LIBRECHAT_MEILI_MASTER_KEY': () => genSecret(16),
    'SEARXNG_SECRET_KEY': () => genSecret(32),
    'LIBRECHAT_SEARXNG_API_KEY': () => genSecret(32),
    'FIRECRAWL_BULL_AUTH_KEY': () => genSecret(16),
    // n8n
    'N8N_ENCRYPTION_KEY': () => genBase64Secret(32), // 32 bytes = 44 base64 chars
    'N8N_POSTGRES_PASSWORD': () => genPassword(16),
    'N8N_OWNER_EMAIL': () => `admin-${crypto.randomBytes(4).toString('hex')}@n8n.local`,
    'N8N_OWNER_PASSWORD': () => genPassword(16),
};

type PromptType = 'input' | 'password';

interface PromptConfig {
    message: string;
    type: PromptType;
    defaultGen?: () => string;
    prodOnly?: boolean; // Only prompt in production mode
}

/**
 * Variables that should prompt the user
 */
const PROMPTS: Record<string, PromptConfig> = {
    'UID': { message: 'Docker Host User ID (UID):', type: 'input', defaultGen: () => '1000' },
    'GID': { message: 'Docker Host Group ID (GID):', type: 'input', defaultGen: () => '1000' },
    'DOMAIN': { message: 'Domain or IP (e.g. localhost or ai.faktenforum.org):', type: 'input' },
    'OPENROUTER_KEY': { message: 'OpenRouter API Key:', type: 'password' },
    'LIBRECHAT_JINA_API_KEY': { message: 'Jina API Key (optional, press enter to skip):', type: 'input' },
    'LIBRECHAT_OCR_API_KEY': { message: 'Mistral OCR API Key (optional, press enter to skip):', type: 'password' },

    // DB Timetable MCP Server
    'MCP_DB_TIMETABLE_CLIENT_ID': { message: 'DB Timetable API Client ID (optional, press enter to skip):', type: 'input' },
    'MCP_DB_TIMETABLE_CLIENT_SECRET': { message: 'DB Timetable API Client Secret (optional, press enter to skip):', type: 'password' },

    // YTPTube MCP
    'YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL': { message: 'YTPTube public download base URL (optional; e.g. https://ytptube.<DOMAIN>):', type: 'input' },
    'YTPTUBE_PROXY': { message: 'YTPTube proxy URL (optional; press enter to skip):', type: 'password' },

    // Mongo (using --noauth, so INITDB credentials not needed)
    'LIBRECHAT_MONGO_DATABASE': { message: 'Mongo Database Name:', type: 'input', defaultGen: () => 'librechat' },

    // VectorDB
    'LIBRECHAT_VECTORDB_PASSWORD': { message: 'VectorDB (Postgres) Password:', type: 'password', defaultGen: () => genPassword(16) },

    // Firecrawl
    'FIRECRAWL_POSTGRES_PASSWORD': { message: 'Firecrawl Postgres Password:', type: 'password', defaultGen: () => genPassword(16) },
    'FIRECRAWL_RABBITMQ_USER': { message: 'Firecrawl RabbitMQ Username:', type: 'input', defaultGen: () => 'firecrawl' },
    'FIRECRAWL_RABBITMQ_PASSWORD': { message: 'Firecrawl RabbitMQ Password:', type: 'password', defaultGen: () => genPassword(16) },

    // Email (Production only)
    'EMAIL_PASSWORD': { message: 'SendGrid API Key (for email verification):', type: 'password', prodOnly: true },
    'EMAIL_FROM': { message: 'Email From Address (e.g., noreply@faktenforum.org):', type: 'input', prodOnly: true },
    'LIBRECHAT_DEFAULT_ADMINS': { message: 'Default LibreChat Admin Emails (comma-separated, optional):', type: 'input' },
};

/**
 * Migration helper: map old keys to new keys if missing
 */
const MIGRATIONS: Record<string, string> = {
    'OPENROUTER_API_KEY': 'OPENROUTER_KEY',
    'SEARCH': 'LIBRECHAT_SEARCH_ENABLED',
    'SEARXNG_INSTANCE_URL': 'LIBRECHAT_SEARXNG_URL',
    'SEARXNG_API_KEY': 'LIBRECHAT_SEARXNG_API_KEY',
    'JINA_API_KEY': 'LIBRECHAT_JINA_API_KEY',
    'JINA_API_URL': 'LIBRECHAT_JINA_API_URL',
    'USE_DB_AUTHENTICATION': 'FIRECRAWL_USE_DB_AUTHENTICATION',
};

// ============================================================================
// File I/O Functions
// ============================================================================

/**
 * Load existing environment file
 */
function loadExistingEnv(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    return dotenv.parse(fs.readFileSync(filePath));
}

/**
 * Parse environment file into key-value map
 */
function parseEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const envMap: Record<string, string> = {};

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
            envMap[key] = valueParts.join('=');
        }
    }

    return envMap;
}

/**
 * Apply migrations to existing environment
 */
function applyMigrations(existingEnv: Record<string, string>): void {
    for (const [oldKey, newKey] of Object.entries(MIGRATIONS)) {
        if (existingEnv[oldKey] && !existingEnv[newKey]) {
            existingEnv[newKey] = existingEnv[oldKey];
        }
    }
}

/** True if key is a migration source or target — do not preserve in "unprocessed" pass */
function isMigrationKey(key: string): boolean {
    return key in MIGRATIONS || Object.values(MIGRATIONS).includes(key);
}

// ============================================================================
// Variable Processing Functions
// ============================================================================

/**
 * Process auto-generated variable
 */
function processAutoGenerated(
    key: string,
    currentValue: string | undefined,
    generator: () => string
): string {
    if (!currentValue || currentValue === 'change-me' || currentValue.includes('change-me')) {
        const secret = generator();
        console.log(`✨ Generated new secret for ${key}`);
        return secret;
    }
    return currentValue;
}

/**
 * Process prompted variable
 */
async function processPrompted(
    key: string,
    config: PromptConfig,
    currentValue: string | undefined,
    defaultValue: string,
    isProdOrDevMode: boolean,
    skipPrompts: boolean
): Promise<string> {
    // Skip prod-only prompts in local/dev mode
    if (config.prodOnly && !isProdOrDevMode) {
        return currentValue !== undefined ? currentValue : defaultValue;
    }

    // Skip prompts if --yes flag is set
    if (skipPrompts) {
        const suggested = config.defaultGen ? config.defaultGen() : defaultValue;
        return currentValue || suggested;
    }

    // Prompt user
    const hasExisting = !!currentValue;
    const suggested = config.defaultGen ? config.defaultGen() : defaultValue;

    const msg = hasExisting
        ? `${config.message} (already set, enter to keep)`
        : `${config.message} (default: ${config.type === 'password' ? 'generated' : suggested})`;

    if (config.type === 'password') {
        const val = await password({ message: msg, mask: '*' });
        return val === '' ? (currentValue || suggested) : val;
    } else {
        return await input({ message: msg, default: currentValue || suggested });
    }
}

/**
 * Resolve variable expansions (e.g., ${VAR_NAME}) in environment lines
 * Supports multiple expansions per value and handles dependencies
 */
function resolveVariableExpansions(envLines: string[]): string[] {
    // Build initial map of all key-value pairs
    const envMap = new Map<string, string>();
    const lineMap = new Map<string, { line: string; key: string; value: string }>();

    for (const line of envLines) {
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
            const value = valueParts.join('=');
            envMap.set(key, value);
            lineMap.set(key, { line, key, value });
        }
    }

    // Resolve expansions iteratively until no more changes occur
    let changed = true;
    let iterations = 0;
    const maxIterations = 100; // Prevent infinite loops
    const resolvedExpansions: Array<{ key: string; varName: string }> = [];

    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;

        for (const [key, entry] of lineMap.entries()) {
            let value = entry.value;

            // Check if value contains expansions
            if (!containsVariableExpansion(value)) {
                continue;
            }

            // Extract all variable names from expansions
            const varNames = extractVariableNames(value);
            let newValue = value;

            // Replace each expansion with its resolved value
            for (const varName of varNames) {
                const resolvedValue = envMap.get(varName);

                if (resolvedValue && !containsVariableExpansion(resolvedValue)) {
                    // Replace ${VAR_NAME} with resolved value (replace all occurrences)
                    newValue = newValue.replace(new RegExp(`\\$\\{${varName}\\}`, 'g'), resolvedValue);
                    resolvedExpansions.push({ key, varName });
                } else if (resolvedValue && containsVariableExpansion(resolvedValue)) {
                    // The referenced variable itself contains expansions - will be resolved in next iteration
                    // Do nothing, will be resolved in next iteration
                } else {
                    // Variable not found - keep expansion (will be resolved at runtime by docker-compose)
                    // Do nothing, keep expansion
                }
            }

            // Update if value changed
            if (newValue !== value) {
                entry.value = newValue;
                envMap.set(key, newValue);
                changed = true;
            }
        }
    }

    // Log resolved expansions
    if (resolvedExpansions.length > 0) {
        const uniqueResolutions = new Map<string, string>();
        for (const { key, varName } of resolvedExpansions) {
            uniqueResolutions.set(`${key} -> ${varName}`, '');
        }
        if (uniqueResolutions.size > 0) {
            console.log(`🔗 Resolved ${uniqueResolutions.size} variable expansion(s)`);
        }
    }

    if (iterations >= maxIterations) {
        console.warn('⚠️  Warning: Variable expansion resolution reached max iterations. Some expansions may not be resolved.');
    }

    // Rebuild lines with resolved values
    const resolvedLines: string[] = [];

    for (const line of envLines) {
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const [key, ...valueParts] = trimmed.split('=');
        if (!key || valueParts.length === 0) {
            continue;
        }

        const entry = lineMap.get(key);
        if (entry) {
            resolvedLines.push(`${key}=${entry.value}`);
        }
    }

    return resolvedLines;
}

// ============================================================================
// Main Processing Logic
// ============================================================================

/**
 * Process environment file lines from env.local.example
 */
async function processEnvExample(
    exampleContent: string,
    baseDefaults: Record<string, string>,
    existingEnv: Record<string, string>,
    isProdMode: boolean,
    isDevMode: boolean,
    skipPrompts: boolean
): Promise<string[]> {
    const finalEnvLines: string[] = [];
    const processedKeys = new Set<string>();

    for (const line of exampleContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const [key, ...valueParts] = trimmed.split('=');
        if (!key || processedKeys.has(key)) continue;

        processedKeys.add(key);
        const defaultValue = baseDefaults[key] !== undefined ? baseDefaults[key] : valueParts.join('=');
        const currentValue = existingEnv[key];

        if (AUTO_GENERATED[key]) {
            const value = processAutoGenerated(key, currentValue, AUTO_GENERATED[key]);
            finalEnvLines.push(`${key}=${value}`);
            continue;
        }

        // Process prompted variables
        if (PROMPTS[key]) {
            const value = await processPrompted(
                key,
                PROMPTS[key],
                currentValue,
                defaultValue,
                isProdMode || isDevMode,
                skipPrompts
            );
            finalEnvLines.push(`${key}=${value}`);
            continue;
        }

        // Default: keep existing or use example value
        finalEnvLines.push(`${key}=${currentValue !== undefined ? currentValue : defaultValue}`);
    }

    for (const [key, value] of Object.entries(existingEnv)) {
        if (processedKeys.has(key) || AUTO_GENERATED[key] || PROMPTS[key] || isMigrationKey(key)) continue;
        finalEnvLines.push(`${key}=${value}`);
        processedKeys.add(key);
    }

    return finalEnvLines;
}

/**
 * Add environment-specific variables from env.prod.example or env.dev.example
 */
function addProductionVariables(
    envContent: string,
    baseDefaults: Record<string, string>,
    existingEnv: Record<string, string>,
    processedKeys: Set<string>
): string[] {
    const envLines: string[] = [];

    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const [key] = trimmed.split('=');
        if (key && !processedKeys.has(key)) {
            const currentValue = existingEnv[key];
            const defaultValue = baseDefaults[key];
            envLines.push(`${key}=${currentValue !== undefined ? currentValue : defaultValue}`);
            processedKeys.add(key);
        }
    }

    return envLines;
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const isProdMode = args.includes('--prod');
    const isDevMode = args.includes('--dev');
    const skipPrompts = args.includes('--yes') || args.includes('-y');
    
    // Determine target file based on mode
    let targetFile: string;
    let modeName: string;
    if (isProdMode) {
        targetFile = PROD_ENV_FILE;
        modeName = 'Production';
    } else if (isDevMode) {
        targetFile = DEV_ENV_FILE;
        modeName = 'Test';
    } else {
        targetFile = LOCAL_ENV_FILE;
        modeName = 'Local';
    }

    console.log(`\n🚀 AI Chat Interface - Environment Setup (TypeScript) [${modeName} Mode]${skipPrompts ? ' [Auto Mode]' : ''}\n`);
    if (skipPrompts) {
        console.log('⚡ Skipping prompts, using defaults and existing values...\n');
    }

    // 1. Load existing environment file
    const defaultsFile = (isProdMode || isDevMode) && fs.existsSync(targetFile) ? targetFile : LOCAL_ENV_FILE;
    const existingEnv = loadExistingEnv(defaultsFile);

    if (Object.keys(existingEnv).length > 0) {
        console.log(`📄 Loading existing values from ${path.basename(defaultsFile)} (file will be regenerated)...`);
    } else {
        console.log(`📝 Creating new ${path.basename(targetFile)} file...`);
    }

    // 2. Apply migrations
    applyMigrations(existingEnv);

    // 3. Read env.local.example
    if (!fs.existsSync(LOCAL_EXAMPLE_FILE)) {
        console.log('❌ Error: env.local.example not found. Please ensure it exists in the root directory.');
        process.exit(1);
    }

    const exampleContent = fs.readFileSync(LOCAL_EXAMPLE_FILE, 'utf-8');
    const baseDefaults = parseEnvFile(LOCAL_EXAMPLE_FILE);

    // 4. Merge with environment-specific example file
    if (isProdMode && fs.existsSync(PROD_EXAMPLE_FILE)) {
        console.log('📦 Loading production overrides from env.prod.example...');
        const prodDefaults = parseEnvFile(PROD_EXAMPLE_FILE);
        Object.assign(baseDefaults, prodDefaults);
    } else if (isDevMode && fs.existsSync(DEV_EXAMPLE_FILE)) {
        console.log('📦 Loading test environment overrides from env.dev.example...');
        const devDefaults = parseEnvFile(DEV_EXAMPLE_FILE);
        Object.assign(baseDefaults, devDefaults);
    }

    // 5. Process env.local.example lines
    const finalEnvLines = await processEnvExample(
        exampleContent,
        baseDefaults,
        existingEnv,
        isProdMode,
        isDevMode,
        skipPrompts
    );

    // 6. Add environment-specific variables
    if (isProdMode && fs.existsSync(PROD_EXAMPLE_FILE)) {
        const prodContent = fs.readFileSync(PROD_EXAMPLE_FILE, 'utf-8');
        const processedKeys = new Set(
            finalEnvLines
                .filter(line => !line.trim().startsWith('#') && line.includes('='))
                .map(line => line.split('=')[0])
        );
        const prodLines = addProductionVariables(prodContent, baseDefaults, existingEnv, processedKeys);
        finalEnvLines.push(...prodLines);
    } else if (isDevMode && fs.existsSync(DEV_EXAMPLE_FILE)) {
        const devContent = fs.readFileSync(DEV_EXAMPLE_FILE, 'utf-8');
        const processedKeys = new Set(
            finalEnvLines
                .filter(line => !line.trim().startsWith('#') && line.includes('='))
                .map(line => line.split('=')[0])
        );
        const devLines = addProductionVariables(devContent, baseDefaults, existingEnv, processedKeys);
        finalEnvLines.push(...devLines);
    }

    // 7. Resolve variable expansions
    const resolvedEnvLines = resolveVariableExpansions(finalEnvLines);

    // 8. Filter out comments and empty lines
    const filteredLines = resolvedEnvLines.filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
    });

    // 9. Write final file
    const finalContent = filteredLines.join('\n');
    fs.writeFileSync(targetFile, finalContent);

    // 10. Summary
    const processedKeys = new Set(
        filteredLines
            .filter(line => line.includes('='))
            .map(line => line.split('=')[0])
    );
    const newVarsCount = Array.from(processedKeys).filter(k => !existingEnv[k]).length;
    const preservedVarsCount = Array.from(processedKeys).filter(k => existingEnv[k]).length;

    if (isProdMode || isDevMode) {
        const envType = isProdMode ? 'Production' : 'Test';
        console.log(`\n✅ ${envType} environment file regenerated!`);
        console.log(`   📝 File: ${path.basename(targetFile)}`);
        console.log(`   🔄 Variables: ${processedKeys.size} total (${preservedVarsCount} preserved, ${newVarsCount} new)`);
        console.log('\n📦 Next steps for Portainer deployment:');
        console.log(`  1. Copy the contents of ${path.basename(targetFile)}`);
        console.log('  2. In Portainer: Stack → Editor → Environment variables (Advanced mode)');
        console.log('  3. Paste the environment variables');
        console.log('  4. Deploy stack → librechat-init will generate config automatically');
        const exampleFile = isProdMode ? 'env.prod.example' : 'env.dev.example';
        console.log(`\n💡 Tip: Re-run this script anytime env.local.example or ${exampleFile} changes`);
    } else {
        console.log(`\n✅ Environment file regenerated!`);
        console.log(`   📝 File: ${path.basename(targetFile)}`);
        console.log(`   🔄 Variables: ${processedKeys.size} total (${preservedVarsCount} preserved, ${newVarsCount} new)`);
        console.log('\n💡 Tip: Re-run this script anytime env.local.example changes');
    }
}

main().catch(err => {
    if (err.name === 'ExitPromptError') {
        console.log('\n👋 Setup cancelled.');
    } else {
        console.error('\n❌ An error occurred:', err);
    }
    process.exit(1);
});
