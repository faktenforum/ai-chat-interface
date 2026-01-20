import type { KnownModel } from '../constants/models.ts';
import type { OpenRouterModel } from '../services/openrouter.ts';

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

export function formatKnownModel(model: KnownModel): string {
  return `**${model.name}** (${model.id})
- Description: ${model.description}
- Supports Aspect Ratio: ${model.supportsAspectRatio ? 'Yes' : 'No'}
- Supports Image Size: ${model.supportsImageSize ? 'Yes' : 'No'}
- Strengths: ${model.strengths.join(', ')}
- Weaknesses: ${model.weaknesses.join(', ')}
- Recommended for: ${model.recommended_for.join(', ')}`;
}

export function formatApiModel(model: ModelInfo): string {
  const pricing = model.pricing
    ? `\n  - Pricing: Prompt: ${model.pricing.prompt || 'N/A'}, Completion: ${model.pricing.completion || 'N/A'}`
    : '';
  const contextLength = model.context_length
    ? `\n  - Context Length: ${model.context_length.toLocaleString()} tokens`
    : '';
  const description = model.description ? `\n  - Description: ${model.description}` : '';
  
  return `**${model.name}** (${model.id})${description}${pricing}${contextLength}`;
}

export function formatModelDetails(
  model: OpenRouterModel,
  knownModel?: KnownModel,
): string {
  const pricing = model.pricing
    ? `\n- Pricing: Prompt: ${model.pricing.prompt || 'N/A'}, Completion: ${model.pricing.completion || 'N/A'}`
    : '';
  const contextLength = model.context_length
    ? `\n- Context Length: ${model.context_length.toLocaleString()} tokens`
    : '';
  const description = model.description ? `\n- Description: ${model.description}` : '';
  
  const knownInfo = knownModel
    ? `\n\n**Known Model Information:**\n- Supports Aspect Ratio: ${knownModel.supportsAspectRatio ? 'Yes' : 'No'}\n- Supports Image Size: ${knownModel.supportsImageSize ? 'Yes' : 'No'}\n- Strengths: ${knownModel.strengths.join(', ')}\n- Recommended for: ${knownModel.recommended_for.join(', ')}`
    : '';
  
  return `${description}${pricing}${contextLength}${knownInfo}`;
}
