import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { CodeBlock } from './types.ts';
import {
  MAX_CHUNK_CHARS,
  MIN_CHUNK_CHARS,
  MIN_CHUNK_REMAINDER_CHARS,
  MAX_CHARS_TOLERANCE_FACTOR,
} from './constants.ts';
import type { Node as TreeSitterNode } from 'web-tree-sitter';
import { loadRequiredLanguageParsers } from './tree-sitter/language-loader.ts';

// The AST-based chunking flow and helpers are inspired by Kilo Code's CodeParser
// (kilocode/src/services/code-index/processors/parser.ts) and reuse the same
// min/max character heuristics. Kilo Code is licensed under the Apache License,
// Version 2.0; see the upstream LICENSE for full terms.

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

function chunkTextByLines(
  filePath: string,
  fileHash: string,
  lines: string[],
  seenSegmentHashes: Set<string>,
  baseStartLine: number,
): CodeBlock[] {
  const chunks: CodeBlock[] = [];
  const effectiveMaxChars = Math.floor(MAX_CHUNK_CHARS * MAX_CHARS_TOLERANCE_FACTOR);
  let currentChunkLines: string[] = [];
  let currentChunkLength = 0;
  let chunkStartLineIndex = 0;

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

function chunkLeafNodeByLines(
  node: TreeSitterNode,
  filePath: string,
  fileHash: string,
  seenSegmentHashes: Set<string>,
): CodeBlock[] {
  const lines = node.text.split('\n');
  const baseStartLine = node.startPosition.row + 1;
  return chunkTextByLines(filePath, fileHash, lines, seenSegmentHashes, baseStartLine);
}

/**
 * AST-aware chunking using tree-sitter for a subset of languages (TS/TSX/JS/JSX/JSON),
 * with a guaranteed fallback to pure line-based chunking.
 */
export async function chunkFileWithAst(
  filePath: string,
  content: string,
  fileHash: string,
): Promise<CodeBlock[]> {
  const ext = extname(filePath).toLowerCase();

  // Only attempt AST-based chunking for a small set of well-supported extensions.
  const astSupported = new Set(['.ts', '.tsx', '.js', '.jsx', '.json']);
  if (!astSupported.has(ext)) {
    return chunkFile(filePath, content, fileHash);
  }

  const seenSegmentHashes = new Set<string>();

  try {
    const parsers = await loadRequiredLanguageParsers([filePath]);
    const key = ext.slice(1); // remove leading dot
    const language = parsers[key];
    if (!language) {
      return chunkFile(filePath, content, fileHash);
    }

    const tree = language.parser.parse(content);
    const captures = tree ? language.query.captures(tree.rootNode) : [];

    if (!captures || captures.length === 0) {
      return chunkFile(filePath, content, fileHash);
    }

    const results: CodeBlock[] = [];
    const queue: TreeSitterNode[] = captures.map((c) => c.node);

    while (queue.length > 0) {
      const currentNode = queue.shift()!;
      const length = currentNode.text.length;

      if (length < MIN_CHUNK_CHARS) {
        continue;
      }

      const maxAllowed = Math.floor(MAX_CHUNK_CHARS * MAX_CHARS_TOLERANCE_FACTOR);
      if (length > maxAllowed) {
        const children = currentNode.children.filter((c): c is TreeSitterNode => c != null);
        if (children.length > 0) {
          queue.push(...children);
        } else {
          const leafChunks = chunkLeafNodeByLines(
            currentNode,
            filePath,
            fileHash,
            seenSegmentHashes,
          );
          results.push(...leafChunks);
        }
      } else {
        const startLine = currentNode.startPosition.row + 1;
        const endLine = currentNode.endPosition.row + 1;
        const chunkContent = currentNode.text;
        const preview = chunkContent.slice(0, 100);
        const segmentHash = createHash('sha256')
          .update(`${filePath}-${startLine}-${endLine}-${chunkContent.length}-${preview}`)
          .digest('hex');

        if (!seenSegmentHashes.has(segmentHash)) {
          seenSegmentHashes.add(segmentHash);
          results.push({
            file_path: filePath,
            start_line: startLine,
            end_line: endLine,
            content: chunkContent,
            file_hash: fileHash,
            segment_hash: segmentHash,
          });
        }
      }
    }

    if (results.length === 0) {
      return chunkFile(filePath, content, fileHash);
    }

    return results;
  } catch {
    return chunkFile(filePath, content, fileHash);
  }
}

