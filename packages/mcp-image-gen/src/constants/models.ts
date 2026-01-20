// Known models registry with their characteristics
export const KNOWN_MODELS = {
    'black-forest-labs/flux.2-pro': {
        id: 'black-forest-labs/flux.2-pro',
        name: 'FLUX.2 Pro',
        description: 'High-quality image generation with excellent detail',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Highest quality', 'Excellent detail', 'Photorealistic', 'Professional results'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['Product images', 'Portraits', 'Detailed art', 'Professional photography'],
        pricing: {
            prompt: '0.04', // $0.04 per image (approx, varies by MP)
            completion: '0',
        },
    },
    'black-forest-labs/flux.2-flex': {
        id: 'black-forest-labs/flux.2-flex',
        name: 'FLUX.2 Flex',
        description: 'Flexible image generation model with good balance of quality and speed',
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['Flexible styles', 'Good balance', 'Fast generation'],
        weaknesses: ['No aspect ratio control', 'No resolution options'],
        recommended_for: ['Varied styles', 'Creative work', 'Quick iterations'],
        pricing: {
            prompt: '0.04',
            completion: '0',
        },
    },
    'google/gemini-2.5-flash-image': {
        id: 'google/gemini-2.5-flash-image',
        name: 'Gemini 2.5 Flash Image',
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
        description: "OpenAI's latest state-of-the-art multimodal model with high-quality image generation",
        supportsAspectRatio: false,
        supportsImageSize: false,
        strengths: ['State-of-the-art reasoning', 'Excellent prompt adherence', 'High detail'],
        weaknesses: ['High cost compared to Gemini'],
        recommended_for: ['Complex prompt instructions', 'Creative art', 'High-quality visuals'],
        pricing: {
            prompt: '0.00001',
            completion: '0.00001',
        },
    },
} as const;

export type KnownModel = (typeof KNOWN_MODELS)[keyof typeof KNOWN_MODELS];
