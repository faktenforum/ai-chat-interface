/**
 * Parse a data URL or raw base64 string into { data, mimeType } for MCP image content.
 * Callers (e.g. OpenRouter client) typically pass data URLs; this supports base64 and http(s) placeholders.
 */
export function parseImageData(imageUrl: string): { data: string; mimeType: string } {
  if (imageUrl.startsWith('data:')) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match?.[1] && match?.[2]) {
      return { data: match[2], mimeType: match[1] };
    }
    
    // Fallback: extract base64 after "base64,"
    const base64Index = imageUrl.indexOf('base64,');
    if (base64Index !== -1) {
      const data = imageUrl.substring(base64Index + 7);
      const mimeMatch = imageUrl.match(/^data:([^;]+)/);
      return { data, mimeType: mimeMatch?.[1] || 'image/png' };
    }
    
    throw new Error('Invalid data URL format: could not extract base64 data');
  }
  
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return { data: imageUrl, mimeType: 'image/png' };
  }
  
  // Assume raw base64
  return { data: imageUrl, mimeType: 'image/png' };
}
