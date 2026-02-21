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
}

export interface SearchResult {
  file_path: string;
  score: number;
  start_line: number;
  end_line: number;
  code_chunk: string;
}

export type IndexStatus = 'standby' | 'indexing' | 'indexed' | 'error';

export interface IndexState {
  status: IndexStatus;
  message: string;
  files_processed: number;
  files_total: number;
}
