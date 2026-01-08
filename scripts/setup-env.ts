#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { input, password } from '@inquirer/prompts';
import dotenv from 'dotenv';

const ROOT_DIR = process.cwd();
const ENV_FILE = path.join(ROOT_DIR, '.env');
const STACK_ENV_FILE = path.join(ROOT_DIR, 'stack.env');
const EXAMPLE_FILE = path.join(ROOT_DIR, 'env.example');
const PROD_EXAMPLE_FILE = path.join(ROOT_DIR, 'env.prod.example');

/**
 * Generate a random hex string
 */
const genSecret = (length: number = 32): string => crypto.randomBytes(length).toString('hex');

/**
 * Generate a random short string for usernames/dbnames
 */
const genShortId = (prefix: string): string => `${prefix}_${crypto.randomBytes(3).toString('hex')}`;

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
    'FIRECRAWL_BULL_AUTH_KEY': () => genSecret(16),
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

    // Mongo (using --noauth, so INITDB credentials not needed)
    'LIBRECHAT_MONGO_DATABASE': { message: 'Mongo Database Name:', type: 'input', defaultGen: () => 'librechat' },

    // VectorDB
    'LIBRECHAT_VECTORDB_PASSWORD': { message: 'VectorDB (Postgres) Password:', type: 'password', defaultGen: () => genSecret(16) },

    // Firecrawl
    'FIRECRAWL_POSTGRES_PASSWORD': { message: 'Firecrawl Postgres Password:', type: 'password', defaultGen: () => genSecret(16) },
    'FIRECRAWL_RABBITMQ_USER': { message: 'Firecrawl RabbitMQ Username:', type: 'input', defaultGen: () => 'firecrawl' },
    'FIRECRAWL_RABBITMQ_PASSWORD': { message: 'Firecrawl RabbitMQ Password:', type: 'password', defaultGen: () => genSecret(16) },

    // Email (Production only)
    'EMAIL_PASSWORD': { message: 'SendGrid API Key (for email verification):', type: 'password', prodOnly: true },
    'EMAIL_FROM': { message: 'Email From Address (e.g., noreply@faktenforum.org):', type: 'input', prodOnly: true },
};

async function main() {
    const args = process.argv.slice(2);
    const isProdMode = args.includes('--prod');
    const skipPrompts = args.includes('--yes') || args.includes('-y');
    const targetFile = isProdMode ? STACK_ENV_FILE : ENV_FILE;

    console.log(`\n🚀 AI Chat Interface - Environment Setup (TypeScript)${isProdMode ? ' [Production Mode]' : ''}${skipPrompts ? ' [Auto Mode]' : ''}\n`);
    if (skipPrompts) {
        console.log('⚡ Skipping prompts, using defaults and existing values...\n');
    }

    // 1. Load existing env file to preserve user values (API keys, passwords, etc.)
    // File will be completely rewritten based on env.example structure
    let existingEnv: Record<string, string> = {};
    const defaultsFile = isProdMode && fs.existsSync(targetFile) ? targetFile : ENV_FILE;

    if (fs.existsSync(defaultsFile)) {
        console.log(`📄 Loading existing values from ${path.basename(defaultsFile)} (file will be regenerated)...`);
        existingEnv = dotenv.parse(fs.readFileSync(defaultsFile));
    } else {
        console.log(`📝 Creating new ${path.basename(targetFile)} file...`);
    }

    // Migration helper: map old keys to new keys if missing
    const MIGRATIONS: Record<string, string> = {
        'OPENROUTER_API_KEY': 'OPENROUTER_KEY',
        'SEARCH': 'LIBRECHAT_SEARCH_ENABLED',
        'SEARXNG_INSTANCE_URL': 'LIBRECHAT_SEARXNG_URL',
        'SEARXNG_API_KEY': 'LIBRECHAT_SEARXNG_API_KEY',
        'JINA_API_KEY': 'LIBRECHAT_JINA_API_KEY',
        'JINA_API_URL': 'LIBRECHAT_JINA_API_URL',
        'USE_DB_AUTHENTICATION': 'FIRECRAWL_USE_DB_AUTHENTICATION',
    };

    for (const [oldKey, newKey] of Object.entries(MIGRATIONS)) {
        if (existingEnv[oldKey] && !existingEnv[newKey]) {
            existingEnv[newKey] = existingEnv[oldKey];
        }
    }

    // 2. Read env.example to get the base variable structure
    if (!fs.existsSync(EXAMPLE_FILE)) {
        console.log('❌ Error: env.example not found. Please ensure it exists in the root directory.');
        process.exit(1);
    }

    const exampleContent = fs.readFileSync(EXAMPLE_FILE, 'utf-8');
    let baseDefaults: Record<string, string> = {};

    // Parse env.example into a map
    for (const line of exampleContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
            baseDefaults[key] = valueParts.join('=');
        }
    }

    // 3. In production mode, merge with env.prod.example overrides
    if (isProdMode && fs.existsSync(PROD_EXAMPLE_FILE)) {
        console.log('📦 Loading production overrides from env.prod.example...');
        const prodContent = fs.readFileSync(PROD_EXAMPLE_FILE, 'utf-8');

        for (const line of prodContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const [key, ...valueParts] = trimmed.split('=');
            if (key) {
                baseDefaults[key] = valueParts.join('=');
            }
        }
    }

    // 4. Build final env file
    const finalEnvLines: string[] = [];
    const processedKeys = new Set<string>();

    // Process all lines from env.example to preserve structure
    for (const line of exampleContent.split('\n')) {
        const trimmed = line.trim();

        // Header, comments, or empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            finalEnvLines.push(line);
            continue;
        }

        const [key, ...valueParts] = trimmed.split('=');
        if (!key) continue;
        
        // Skip if already processed (avoid duplicates)
        if (processedKeys.has(key)) {
            continue;
        }
        
        // Use value from baseDefaults (which includes prod overrides) if available, otherwise from example
        const defaultValue = baseDefaults[key] !== undefined ? baseDefaults[key] : valueParts.join('=');
        const currentValue = existingEnv[key];
        processedKeys.add(key);

        // Check if it's an auto-generated secret
        if (AUTO_GENERATED[key]) {
            if (!currentValue || currentValue === 'change-me' || currentValue.includes('change-me')) {
                const secret = AUTO_GENERATED[key]();
                console.log(`✨ Generated new secret for ${key}`);
                finalEnvLines.push(`${key}=${secret}`);
            } else {
                finalEnvLines.push(`${key}=${currentValue}`);
            }
            continue;
        }

        // Check if it's a prompted variable
        if (PROMPTS[key]) {
            const p = PROMPTS[key];

            // Skip prod-only prompts in dev mode
            if (p.prodOnly && !isProdMode) {
                finalEnvLines.push(`${key}=${currentValue !== undefined ? currentValue : defaultValue}`);
                continue;
            }

            const hasExisting = !!currentValue;
            const suggested = p.defaultGen ? p.defaultGen() : defaultValue;

            // If --yes flag is set, skip prompts and use existing or default
            if (skipPrompts) {
                const val = currentValue || suggested;
                finalEnvLines.push(`${key}=${val}`);
                continue;
            }

            const msg = hasExisting
                ? `${p.message} (already set, enter to keep)`
                : `${p.message} (default: ${p.type === 'password' ? 'generated' : suggested})`;

            let val: string;
            if (p.type === 'password') {
                val = await password({ message: msg, mask: '*' });
                // Fallback: keep existing if set, or use suggested if not
                if (val === '') {
                    val = currentValue || suggested;
                }
            } else {
                val = await input({ message: msg, default: currentValue || suggested });
            }

            finalEnvLines.push(`${key}=${val}`);
            continue;
        }

        // Default: Keep existing or use example value
        finalEnvLines.push(`${key}=${currentValue !== undefined ? currentValue : defaultValue}`);
    }

    // 5. Add production-only section with full structure from env.prod.example
    if (isProdMode && fs.existsSync(PROD_EXAMPLE_FILE)) {
        const prodContent = fs.readFileSync(PROD_EXAMPLE_FILE, 'utf-8');
        let addedProdSection = false;

        for (const line of prodContent.split('\n')) {
            const trimmed = line.trim();
            
            // Keep comments and empty lines from env.prod.example
            if (!trimmed || trimmed.startsWith('#')) {
                if (!addedProdSection) {
                    finalEnvLines.push('');
                    finalEnvLines.push('# ═══════════════════════════════════════════════════════════════════════════');
                    finalEnvLines.push('# Production-Only Configuration (from env.prod.example)');
                    finalEnvLines.push('# ═══════════════════════════════════════════════════════════════════════════');
                    addedProdSection = true;
                }
                finalEnvLines.push(line);
                continue;
            }

            const [key] = trimmed.split('=');
            if (key && !processedKeys.has(key)) {
                const currentValue = existingEnv[key];
                const defaultValue = baseDefaults[key];
                finalEnvLines.push(`${key}=${currentValue !== undefined ? currentValue : defaultValue}`);
                processedKeys.add(key);
            }
        }
    }

    // 6. Write final file
    const finalContent = finalEnvLines.join('\n');
    fs.writeFileSync(targetFile, finalContent);
    
    // Summary
    const newVarsCount = Array.from(processedKeys).filter(k => !existingEnv[k]).length;
    const preservedVarsCount = Array.from(processedKeys).filter(k => existingEnv[k]).length;
    
    if (isProdMode) {
        console.log(`\n✅ Production environment file regenerated!`);
        console.log(`   📝 File: ${path.basename(targetFile)}`);
        console.log(`   🔄 Variables: ${processedKeys.size} total (${preservedVarsCount} preserved, ${newVarsCount} new)`);
        console.log('\n📦 Next steps for Portainer deployment:');
        console.log('  1. Copy the contents of stack.env');
        console.log('  2. In Portainer: Stack → Editor → Environment variables (Advanced mode)');
        console.log('  3. Paste the environment variables');
        console.log('  4. Deploy stack → config-init will generate config automatically');
        console.log('\n💡 Tip: Re-run this script anytime env.example or env.prod.example changes');
    } else {
        console.log(`\n✅ Environment file regenerated!`);
        console.log(`   📝 File: ${path.basename(targetFile)}`);
        console.log(`   🔄 Variables: ${processedKeys.size} total (${preservedVarsCount} preserved, ${newVarsCount} new)`);
        console.log('\n💡 Tip: Re-run this script anytime env.example changes');
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
