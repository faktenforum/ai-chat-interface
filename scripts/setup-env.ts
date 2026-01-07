#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { input, password } from '@inquirer/prompts';
import dotenv from 'dotenv';

const ROOT_DIR = process.cwd();
const ENV_FILE = path.join(ROOT_DIR, '.env');
const EXAMPLE_FILE = path.join(ROOT_DIR, 'env.example');

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
}

/**
 * Variables that should prompt the user
 */
const PROMPTS: Record<string, PromptConfig> = {
    'UID': { message: 'Docker Host User ID (UID):', type: 'input', defaultGen: () => '1000' },
    'GID': { message: 'Docker Host Group ID (GID):', type: 'input', defaultGen: () => '1000' },
    'DOMAIN': { message: 'Domain or IP (e.g. localhost or ai.faktenforum.org):', type: 'input' },
    'OPENROUTER_API_KEY': { message: 'OpenRouter API Key:', type: 'password' },
    'JINA_API_KEY': { message: 'Jina API Key (optional, press enter to skip):', type: 'input' },

    // Mongo
    'LIBRECHAT_MONGO_INITDB_ROOT_USERNAME': { message: 'Mongo Root Username:', type: 'input', defaultGen: () => genShortId('librechat') },
    'LIBRECHAT_MONGO_INITDB_ROOT_PASSWORD': { message: 'Mongo Root Password:', type: 'password', defaultGen: () => genSecret(16) },
    'LIBRECHAT_MONGO_DATABASE': { message: 'Mongo Database Name:', type: 'input', defaultGen: () => 'librechat' },

    // VectorDB
    'LIBRECHAT_VECTORDB_PASSWORD': { message: 'VectorDB (Postgres) Password:', type: 'password', defaultGen: () => genSecret(16) },

    // OpenWebUI (Currently disabled for production)
    // 'OPENWEBUI_ADMIN_EMAIL': { message: 'OpenWebUI Admin Email:', type: 'input' },
    // 'OPENWEBUI_ADMIN_PASSWORD': { message: 'OpenWebUI Admin Password:', type: 'password', defaultGen: () => genSecret(16) },

    // Firecrawl
    'FIRECRAWL_POSTGRES_PASSWORD': { message: 'Firecrawl Postgres Password:', type: 'password', defaultGen: () => genSecret(16) },
};

async function main() {
    const args = process.argv.slice(2);
    const isPortainerMode = args.includes('--portainer');
    const targetFile = isPortainerMode ? path.join(ROOT_DIR, 'docker-compose.portainer.env') : ENV_FILE;

    console.log(`\n🚀 AI Chat Interface - Environment Setup (TypeScript)${isPortainerMode ? ' [Portainer Mode]' : ''}\n`);

    // 1. Load existing .env if it exists
    let existingEnv: Record<string, string> = {};
    if (fs.existsSync(ENV_FILE)) {
        console.log('📄 Found existing .env file, loading values as defaults...');
        existingEnv = dotenv.parse(fs.readFileSync(ENV_FILE));
    }

    // 2. Read env.example to get the required variable structure
    if (!fs.existsSync(EXAMPLE_FILE)) {
        console.log('❌ Error: env.example not found. Please ensure it exists in the root directory.');
        process.exit(1);
    }

    const exampleLines = fs.readFileSync(EXAMPLE_FILE, 'utf-8').split('\n');
    const finalEnvLines: string[] = [];

    for (const line of exampleLines) {
        const trimmed = line.trim();

        // Header, comments, or empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            finalEnvLines.push(line);
            continue;
        }

        const [key, ...valueParts] = trimmed.split('=');
        const defaultValue = valueParts.join('=');
        const currentValue = existingEnv[key];

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
            const hasExisting = !!currentValue;
            const suggested = p.defaultGen ? p.defaultGen() : defaultValue;

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

    // 3. Write final file
    fs.writeFileSync(targetFile, finalEnvLines.join('\n'));
    if (isPortainerMode) {
        console.log(`\n✅ Portainer setup complete! Values written to ${path.basename(targetFile)}`);
        console.log('You can copy the contents of this file into Portainer\'s "Advanced Mode" environment section.');
    } else {
        console.log('\n✅ Setup complete! Your .env file has been updated.\n');
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
