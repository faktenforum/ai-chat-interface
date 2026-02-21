/**
 * Line-based code chunking with SHA-256 hashes.
 * No tree-sitter dependency; chunks at line boundaries up to MAX_CHUNK_CHARS.
 */

import { createHash } from 'node:crypto';
import type { CodeBlock } from './types.ts';
import {
  MAX_CHUNK_CHARS,
  MIN_CHUNK_CHARS,
  MIN_CHUNK_REMAINDER_CHARS,
  MAX_CHARS_TOLERANCE_FACTOR,
} from './constants.ts';

/**
 * Create SHA-256 hash of file content for change detection.
 */
export function createFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Chunk a file's content into code blocks by line boundaries.
 * Oversized lines are split by character. Re-balances to avoid tiny remainder chunks.
 */
export function chunkFile(
  filePath: string,
  content: string,
  fileHash: string,
): CodeBlock[] {
  const seenSegmentHashes = new Set<string>();
  const lines = content.split('\n');
  const effectiveMaxChars = Math.floor(MAX_CHUNK_CHARS * MAX_CHARS_TOLERANCE_FACTOR);
  const chunks: CodeBlock[] = [];
  let currentChunkLines: string[] = [];
  let currentChunkLength = 0;
  let chunkStartLineIndex = 0;
  const baseStartLine = 1;

  const finalizeChunk = (endLineIndex: number) => {
    if (currentChunkLength >= MIN_CHUNK_CHARS && currentChunkLines.length > 0) {
      const chunkContent = currentChunkLines.join('\n');
      const startLine = baseStartLine + chunkStartLineIndex;
      const endLine = baseStartLine + endLineIndex;
      const contentPreview = chunkContent.slice(0, 100);
      const segmentHash = createHash('sha256')
        .update(`${filePath}-${startLine}-${endLine}-${chunkContent.length}-${contentPreview}`)
        .digest('hex');

      if (!seenSegmentHashes.has(segmentHash)) {
        seenSegmentHashes.add(segmentHash);
        chunks.push({
          file_path: filePath,
          start_line: startLine,
          end_line: endLine,
          content: chunkContent,
          file_hash: fileHash,
          segment_hash: segmentHash,
        });
      }
    }
    currentChunkLines = [];
    currentChunkLength = 0;
    chunkStartLineIndex = endLineIndex + 1;
  };

  const createSegmentBlock = (
    segment: string,
    originalLineNumber: number,
    startCharIndex: number,
  ) => {
    const segmentPreview = segment.slice(0, 100);
    const segmentHash = createHash('sha256')
      .update(
        `${filePath}-${originalLineNumber}-${originalLineNumber}-${startCharIndex}-${segment.length}-${segmentPreview}`,
      )
      .digest('hex');

    if (!seenSegmentHashes.has(segmentHash)) {
      seenSegmentHashes.add(segmentHash);
      chunks.push({
        file_path: filePath,
        start_line: originalLineNumber,
        end_line: originalLineNumber,
        content: segment,
        file_hash: fileHash,
        segment_hash: segmentHash,
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLength = line.length + (i < lines.length - 1 ? 1 : 0);
    const originalLineNumber = baseStartLine + i;

    if (lineLength > effectiveMaxChars) {
      if (currentChunkLines.length > 0) {
        finalizeChunk(i - 1);
      }
      let remainingLineContent = line;
      let currentSegmentStartChar = 0;
      while (remainingLineContent.length > 0) {
        const segment = remainingLineContent.substring(0, MAX_CHUNK_CHARS);
        remainingLineContent = remainingLineContent.substring(MAX_CHUNK_CHARS);
        createSegmentBlock(segment, originalLineNumber, currentSegmentStartChar);
        currentSegmentStartChar += MAX_CHUNK_CHARS;
      }
      chunkStartLineIndex = i + 1;
      continue;
    }

    if (currentChunkLength > 0 && currentChunkLength + lineLength > effectiveMaxChars) {
      let remainderLength = 0;
      for (let j = i; j < lines.length; j++) {
        remainderLength += lines[j].length + (j < lines.length - 1 ? 1 : 0);
      }

      let splitIndex = i - 1;
      if (
        currentChunkLength >= MIN_CHUNK_CHARS &&
        remainderLength < MIN_CHUNK_REMAINDER_CHARS &&
        currentChunkLines.length > 1
      ) {
        for (let k = i - 2; k >= chunkStartLineIndex; k--) {
          const potentialChunkLines = lines.slice(chunkStartLineIndex, k + 1);
          const potentialChunkLength = potentialChunkLines.join('\n').length + 1;
          const potentialNextChunkLines = lines.slice(k + 1);
          const potentialNextChunkLength = potentialNextChunkLines.join('\n').length + 1;
          if (
            potentialChunkLength >= MIN_CHUNK_CHARS &&
            potentialNextChunkLength >= MIN_CHUNK_REMAINDER_CHARS
          ) {
            splitIndex = k;
            break;
          }
        }
      }

      finalizeChunk(splitIndex);

      if (i >= chunkStartLineIndex) {
        currentChunkLines.push(line);
        currentChunkLength += lineLength;
      } else {
        i = chunkStartLineIndex - 1;
        continue;
      }
    } else {
      currentChunkLines.push(line);
      currentChunkLength += lineLength;
    }
  }

  if (currentChunkLines.length > 0) {
    finalizeChunk(lines.length - 1);
  }

  return chunks;
}
