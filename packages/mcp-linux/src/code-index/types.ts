/**
 * Types for code indexing (semantic code search).
 */

export interface CodeBlock {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  file_hash: string;
  segment_hash: string;
  language?: string;
}

export interface SearchResult {
  file_path: string;
  score: number;
  start_line: number;
  end_line: number;
  code_chunk: string;
}

export interface DebugChunkEntry {
  file_path: string;
  start_line: number;
  end_line: number;
  content_preview: string;
  segment_hash: string;
  char_count: number;
}

export type IndexStatus = 'standby' | 'indexing' | 'indexed' | 'error';

export interface IndexState {
  status: IndexStatus;
  message: string;
  files_processed: number;
  files_total: number;
}
