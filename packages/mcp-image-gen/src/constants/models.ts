/**
 * How to request image output from OpenRouter for this model.
 * - `response_modalities`: use response_modalities: ['image'] (Gemini-style API).
 * - `image_only`: use modalities: ['image'] (image-only models; avoids "no endpoints" when provider does not support image+text).
 * - `image_and_text`: use modalities: ['image', 'text'] (default for multimodal models).
 */
export type ModalityRequest = 'response_modalities' | 'image_only' | 'image_and_text';

/**
 * When resolving model IDs without a namespace (e.g. "flux.2-pro"), try these prefixes.
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
export const EXAMPLE_MODEL_ID = 'black-forest-labs/flux.2-pro';

// Known models registry with their characteristics
export const KNOWN_MODELS = {
    'black-forest-labs/flux.2-pro': {
        id: 'black-forest-labs/flux.2-pro',
        name: 'FLUX.2 Pro',
        modalityRequest: 'image_only' as const,
        description: 'A high-end image generation and editing model focused on frontier-level visual quality and reliability. It delivers strong prompt adherence, stable lighting, sharp textures, and consistent character/style reproduction across multi-reference inputs. Designed for production workloads, it balances speed and quality while supporting text-to-image and image editing up to 4 MP resolution.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Highest quality', 'Excellent detail', 'Photorealistic', 'Professional results', 'Strong prompt adherence', 'Stable lighting', 'Sharp textures', 'Consistent character/style reproduction'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['Product images', 'Portraits', 'Detailed art', 'Professional photography', 'Production workloads', 'Image editing'],
        pricing: {
            prompt: '0.015', // $0.015 per megapixel on input (reference images for editing)
            completion: '0.03', // First megapixel $0.03, subsequent MP $0.015 per MP
        },
    },
    'black-forest-labs/flux.2-flex': {
        id: 'black-forest-labs/flux.2-flex',
        name: 'FLUX.2 Flex',
        modalityRequest: 'image_only' as const,
        description: 'FLUX.2 [flex] excels at rendering complex text, typography, and fine details, and supports multi-reference editing in the same unified architecture.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Complex text rendering', 'Typography', 'Fine details', 'Multi-reference editing', 'Flexible styles', 'Good balance'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['Text-heavy images', 'Typography', 'Multi-reference editing', 'Varied styles', 'Creative work'],
        pricing: {
            prompt: '0.06', // $0.06 per megapixel on input
            completion: '0.06', // $0.06 per megapixel on output
        },
    },
    'black-forest-labs/flux.2-max': {
        id: 'black-forest-labs/flux.2-max',
        name: 'FLUX.2 Max',
        modalityRequest: 'image_only' as const,
        description: 'FLUX.2 [max] is the new top-tier image model from Black Forest Labs, pushing image quality, prompt understanding, and editing consistency to the highest level yet.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Highest quality', 'Best prompt understanding', 'Best editing consistency', 'Top-tier results'],
        weaknesses: ['No aspect ratio control', 'No resolution options', 'Higher cost'],
        recommended_for: ['Premium quality requirements', 'Complex prompts', 'Professional editing', 'Highest quality outputs'],
        pricing: {
            prompt: '0.03', // $0.03 per megapixel on input
            completion: '0.07', // First megapixel $0.07, subsequent MP $0.03 per MP
        },
    },
    'black-forest-labs/flux.2-klein-4b': {
        id: 'black-forest-labs/flux.2-klein-4b',
        name: 'FLUX.2 Klein 4B',
        modalityRequest: 'image_only' as const,
        description: 'FLUX.2 [klein] 4B is the fastest and most cost-effective model in the FLUX.2 family, optimized for high-throughput use cases while maintaining excellent image quality.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Fastest generation', 'Most cost-effective', 'High throughput', 'Excellent quality for speed'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['High-volume generation', 'Cost-sensitive applications', 'Quick iterations', 'Batch processing'],
        pricing: {
            prompt: '0',
            completion: '0.014', // First megapixel $0.014, subsequent MP $0.001 per MP
        },
    },
    'bytedance-seed/seedream-4.5': {
        id: 'bytedance-seed/seedream-4.5',
        name: 'Seedream 4.5',
        modalityRequest: 'image_and_text' as const,
        description: 'Seedream 4.5 is the latest in-house image generation model developed by ByteDance. Compared with Seedream 4.0, it delivers comprehensive improvements, especially in editing consistency, including better preservation of subject details, lighting, and color tone. It also enhances portrait refinement and small-text rendering. The model\'s multi-image composition capabilities have been significantly strengthened, and both reasoning performance and visual aesthetics continue to advance, enabling more accurate and artistically expressive image generation.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Editing consistency', 'Subject detail preservation', 'Lighting preservation', 'Color tone preservation', 'Portrait refinement', 'Small-text rendering', 'Multi-image composition'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['Image editing', 'Portrait refinement', 'Text rendering', 'Multi-image composition', 'Artistic expression'],
        pricing: {
            prompt: '0',
            completion: '0.04', // $0.04 per output image, regardless of size
        },
    },
    'google/gemini-2.5-flash-image': {
        id: 'google/gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image',
        modalityRequest: 'response_modalities' as const,
        description: 'Fast image generation with aspect ratio and resolution control',
        supportsAspectRatio: true,
        supportsImageSize: true,
        strengths: ['Fast generation', 'Aspect ratio control', 'Resolution options', 'Multiple sizes'],
        weaknesses: ['May have lower quality than FLUX.2 Pro for some use cases'],
        recommended_for: ['Social media', 'Quick iterations', 'Custom aspect ratios', 'Multiple resolutions'],
        pricing: {
            prompt: '0.0000003',
            completion: '0.0000025',
        }
    },
    'openai/gpt-5-image': {
        id: 'openai/gpt-5-image',
        name: 'GPT-5 Image',
        modalityRequest: 'image_and_text' as const,
        description: 'GPT-5 Image combines OpenAI\'s GPT-5 model with state-of-the-art image generation capabilities. It offers major improvements in reasoning, code quality, and user experience while incorporating GPT Image 1\'s superior instruction following, text rendering, and detailed image editing.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['State-of-the-art reasoning', 'Excellent prompt adherence', 'High detail', 'Superior instruction following', 'Text rendering', 'Detailed image editing', 'Code quality'],
        weaknesses: ['High cost compared to Gemini'],
        recommended_for: ['Complex prompt instructions', 'Creative art', 'High-quality visuals', 'Instruction-heavy tasks', 'Text in images'],
        pricing: {
            prompt: '0.00001', // $10/M input tokens
            completion: '0.00001', // $10/M output tokens
        },
    },
    'openai/gpt-5-image-mini': {
        id: 'openai/gpt-5-image-mini',
        name: 'GPT-5 Image Mini',
        modalityRequest: 'image_and_text' as const,
        description: 'GPT-5 Image Mini combines OpenAI\'s advanced language capabilities, powered by GPT-5 Mini, with GPT Image 1 Mini for efficient image generation. This natively multimodal model features superior instruction following, text rendering, and detailed image editing with reduced latency and cost. It excels at high-quality visual creation while maintaining strong text understanding, making it ideal for applications that require both efficient image generation and text processing at scale.',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Efficient generation', 'Reduced latency', 'Lower cost', 'Superior instruction following', 'Text rendering', 'Detailed image editing', 'Strong text understanding'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['Cost-effective generation', 'High-volume applications', 'Text-heavy images', 'Instruction following', 'Scale applications'],
        pricing: {
            prompt: '0.0000025', // $2.50/M input tokens
            completion: '0.000002', // $2/M output tokens
        },
    },
} as const;

export type KnownModel = (typeof KNOWN_MODELS)[keyof typeof KNOWN_MODELS];
