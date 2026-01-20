#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

import 'dotenv/config';
import { OpenRouterClient } from '../src/services/openrouter.ts';
import { KNOWN_MODELS } from '../src/constants/models.ts';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

const GREEN = '\u001b[0;32m';
const RED = '\u001b[0;31m';
const YELLOW = '\u001b[1;33m';
const BLUE = '\u001b[0;34m';
const NC = '\u001b[0m';

async function main() {
    if (!OPENROUTER_API_KEY) {
        console.error(`${RED}Error: OPENROUTER_API_KEY or OPENROUTER_KEY is required${NC}`);
        process.exit(1);
    }

    const client = new OpenRouterClient(OPENROUTER_API_KEY, OPENROUTER_BASE_URL);

    console.log(`${BLUE}Fetching all models from OpenRouter...${NC}\n`);

    try {
        const allModels = await client.listModels();
        console.log(`Found total ${allModels.length} models.`);

        const imageModels = allModels.filter(m =>
            m.architecture?.output_modalities?.includes('image') ||
            m.id.toLowerCase().includes('flux') ||
            m.id.toLowerCase().includes('imagen') ||
            m.id.toLowerCase().includes('dalle') ||
            m.name.toLowerCase().includes('flux') ||
            m.name.toLowerCase().includes('image generation')
        );

        console.log(`${GREEN}Found ${imageModels.length} potential image generation models.${NC}\n`);

        const knownIds = new Set(Object.keys(KNOWN_MODELS));
        const newModels = imageModels.filter(m => !knownIds.has(m.id));

        console.log(`${BLUE}--- Known Models Status ---${NC}`);
        for (const [id, info] of Object.entries(KNOWN_MODELS)) {
            const apiMatch = imageModels.find(m => m.id === id);
            if (apiMatch) {
                console.log(`${GREEN}[OK]${NC} ${id} (Found in API)`);
                const pricing = apiMatch.pricing;
                if (pricing) {
                    console.log(`     API Pricing: Prompt: ${pricing.prompt}, Completion: ${pricing.completion}`);
                    console.log(`     Hardcoded:   Prompt: ${info.pricing?.prompt}, Completion: ${info.pricing?.completion}`);
                } else {
                    console.log(`     ${YELLOW}Warning: No pricing data in API for this model.${NC}`);
                }
            } else {
                console.log(`${RED}[MISSING]${NC} ${id} (Not found in API list - will be merged manually)`);
            }
        }

        if (newModels.length > 0) {
            console.log(`\n${YELLOW}--- New Potential Models Detected ---${NC}`);
            newModels.forEach(m => {
                const isPreview = m.id.toLowerCase().includes('preview');
                const color = isPreview ? NC : GREEN;
                console.log(`${color}- ${m.id}${NC} (${m.name})`);
                if (m.description) console.log(`  Description: ${m.description.substring(0, 100)}...`);
                if (m.pricing) console.log(`  Pricing: Prompt: ${m.pricing.prompt}, Completion: ${m.pricing.completion}`);
            });
            console.log(`\n${BLUE}Note: Stable models (highlighted in green) should be considered for addition to KNOWN_MODELS.${NC}`);
        } else {
            console.log(`\n${GREEN}No new stable image models detected.${NC}`);
        }

    } catch (error) {
        console.error(`${RED}Error during maintenance check:${NC}`, error);
    }
}

main().catch(console.error);
