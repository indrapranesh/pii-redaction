/** A slice of the source text plus its absolute character offset. */
export interface TextChunk {
  text: string;
  /** Character offset of this chunk's start within the original text. */
  offset: number;
}

/**
 * Split long text into overlapping windows so entities that straddle a window
 * boundary are still seen whole in at least one window. Transformer encoders
 * cap at ~512 tokens; we window on characters (a safe proxy) with overlap and
 * rely on reconciliation to de-duplicate entities found in the overlap region.
 *
 * @param windowChars size of each window in characters
 * @param overlapChars characters shared between consecutive windows
 */
export function chunkText(
  text: string,
  windowChars = 1600,
  overlapChars = 200,
): TextChunk[] {
  if (windowChars <= 0) throw new Error('windowChars must be positive');
  if (overlapChars < 0 || overlapChars >= windowChars) {
    throw new Error('overlapChars must be in [0, windowChars)');
  }
  if (text.length <= windowChars) return [{ text, offset: 0 }];

  const stride = windowChars - overlapChars;
  const chunks: TextChunk[] = [];
  for (let start = 0; start < text.length; start += stride) {
    const end = Math.min(start + windowChars, text.length);
    chunks.push({ text: text.slice(start, end), offset: start });
    if (end === text.length) break;
  }
  return chunks;
}
