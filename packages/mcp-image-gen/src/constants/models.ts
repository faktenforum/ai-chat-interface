/**
 * When resolving model IDs without a namespace (e.g. "flux-3-image"), try these prefixes.
 * Key: substring that may appear in the user-provided id; value: OpenRouter namespace.
 */
export const MODEL_ID_PREFIXES: Record<string, string> = {
    flux: 'black-forest-labs',
    gpt: 'openai',
    image: 'openai',
    gemini: 'google',
    nano: 'google',
    seedream: 'bytedance-seed',
};

/** Example model ID used in error messages and docs (e.g. "use a supported model like …"). */
export const EXAMPLE_MODEL_ID = 'black-forest-labs/flux-3-image';

// Known models registry with their characteristics
export const KNOWN_MODELS = {
    'black-forest-labs/flux-3-image': {
        id: 'black-forest-labs/flux-3-image',
        name: 'FLUX.3',
        description: 'FLUX.3 is the flagship image generation and editing model from Black Forest Labs, successor of FLUX.2 Pro, Flex and Max. It takes text and reference images, with aspect ratio and resolution control.',
        supportsAspectRatio: true,
        supportsImageSize: true,
        strengths: ['Highest quality', 'Strong prompt adherence', 'Photorealistic', 'Image editing', 'Reference images'],
        weaknesses: ['Slower and pricier than FLUX.3 Klein'],
        recommended_for: ['Product images', 'Portraits', 'Detailed art', 'Professional photography', 'Image editing'],
        pricing: {
            prompt: '0',
            completion: '0.00000982', // $9.82/M image tokens
        },
    },
    'black-forest-labs/flux-3-image-klein': {
        id: 'black-forest-labs/flux-3-image-klein',
        name: 'FLUX.3 Klein',
        description: 'FLUX.3 Klein is the fast and cost-effective model of the FLUX.3 family, successor of FLUX.2 Klein 4B, with open weights.',
        supportsAspectRatio: true,
        supportsImageSize: true,
        strengths: ['Fastest generation', 'Most cost-effective', 'High throughput', 'Open weights'],
        weaknesses: ['Less detail than FLUX.3'],
        recommended_for: ['High-volume generation', 'Cost-sensitive applications', 'Quick iterations', 'Batch processing'],
        pricing: {
            prompt: '0',
            completion: '0.0000019', // $1.9/M image tokens
        },
    },
    'bytedance-seed/seedream-5-0-pro': {
        id: 'bytedance-seed/seedream-5-0-pro',
        name: 'Seedream 5.0 Pro',
        description: 'Seedream 5.0 Pro is ByteDance\'s image generation and editing model, successor of Seedream 4.5, with strong editing consistency, portrait refinement and small-text rendering.',
        supportsAspectRatio: true,
        supportsImageSize: true,
        strengths: ['Editing consistency', 'Portrait refinement', 'Small-text rendering', 'Multi-image composition'],
        weaknesses: ['No 4K resolution'],
        recommended_for: ['Image editing', 'Portrait refinement', 'Text rendering', 'Multi-image composition', 'Artistic expression'],
        pricing: {
            prompt: '0',
            completion: '0.003', // per output image, see OpenRouter for the live token price
        },
    },
    'google/gemini-3.1-flash-image': {
        id: 'google/gemini-3.1-flash-image',
        name: 'Gemini 3.1 Flash Image',
        description: 'Fast image generation from Google.',
        supportsAspectRatio: true,
        supportsImageSize: true,
        strengths: ['Fast generation', 'Extreme aspect ratios (up to 8:1)', 'Resolution options'],
        weaknesses: ['May have lower quality than FLUX.3 for some use cases'],
        recommended_for: ['Social media', 'Quick iterations', 'Custom aspect ratios', 'Multiple resolutions'],
        pricing: {
            prompt: '0.0000005',
            completion: '0.000003',
        }
    },
    'openai/gpt-image-2': {
        id: 'openai/gpt-image-2',
        name: 'GPT Image 2',
        description: 'OpenAI\'s image generation and editing model with strong prompt adherence, text rendering and detailed image editing.',
        supportsAspectRatio: true,
        supportsImageSize: false,
        strengths: ['Excellent prompt adherence', 'High detail', 'Text rendering', 'Detailed image editing'],
        weaknesses: ['No resolution options'],
        recommended_for: ['Complex prompt instructions', 'Creative art', 'High-quality visuals', 'Text in images'],
        pricing: {
            prompt: '0.000008', // $8/M input tokens
            completion: '0.000008', // $8/M output tokens
        },
    },
} as const;

export type KnownModel = (typeof KNOWN_MODELS)[keyof typeof KNOWN_MODELS];
