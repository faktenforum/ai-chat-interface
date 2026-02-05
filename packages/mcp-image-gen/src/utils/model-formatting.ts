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
  return `**${model.name}**
- **Model ID:** \`${model.id}\` (use this exact ID with \`generate_image\`)
- Description: ${model.description}
- Supports Aspect Ratio: ${model.supportsAspectRatio ? 'Yes' : 'No'}
- Supports Image Size: ${model.supportsImageSize ? 'Yes' : 'No'}
- Strengths: ${model.strengths.join(', ')}
- Weaknesses: ${model.weaknesses.join(', ')}
- Recommended for: ${model.recommended_for.join(', ')}`;
}

export function formatApiModel(model: ModelInfo): string {
  const parts: string[] = [
    `**${model.name}**`,
    `  - **Model ID:** \`${model.id}\` (use this exact ID with \`generate_image\`)`,
  ];
  if (model.description) parts.push(`  - Description: ${model.description}`);
  if (model.pricing) {
    parts.push(
      `  - Pricing: Prompt: ${model.pricing.prompt ?? 'N/A'}, Completion: ${model.pricing.completion ?? 'N/A'}`,
    );
  }
  if (model.context_length) {
    parts.push(`  - Context Length: ${model.context_length.toLocaleString()} tokens`);
  }
  return parts.join('\n');
}

export function formatModelDetails(
  model: OpenRouterModel,
  knownModel?: KnownModel,
): string {
  const parts: string[] = [];
  if (model.description) parts.push(`\n- Description: ${model.description}`);
  if (model.pricing) {
    parts.push(
      `\n- Pricing: Prompt: ${model.pricing.prompt ?? 'N/A'}, Completion: ${model.pricing.completion ?? 'N/A'}`,
    );
  }
  if (model.context_length) {
    parts.push(`\n- Context Length: ${model.context_length.toLocaleString()} tokens`);
  }
  if (knownModel) {
    parts.push(
      `\n\n**Known Model Information:**`,
      `\n- Supports Aspect Ratio: ${knownModel.supportsAspectRatio ? 'Yes' : 'No'}`,
      `\n- Supports Image Size: ${knownModel.supportsImageSize ? 'Yes' : 'No'}`,
      `\n- Strengths: ${knownModel.strengths.join(', ')}`,
      `\n- Recommended for: ${knownModel.recommended_for.join(', ')}`,
    );
  }
  return parts.join('');
}

/** Build the usage section text for list_models output. */
export function buildListModelsUsageText(exampleModelId: string): string {
  return `## Usage

To generate an image, use the \`generate_image\` tool with the **exact Model ID** shown above. Example:

\`\`\`json
{
  "model": "${exampleModelId}",
  "prompt": "A beautiful sunset over mountains"
}
\`\`\`

**Important:** Use the Model ID exactly as shown (case-sensitive). Models with detailed metadata are well-tested and recommended. Use \`check_model\` to verify a model ID before generating.`;
}
