/**
 * Configuration and constants for code indexing.
 */

export const MAX_CHUNK_CHARS = 1000;
export const MIN_CHUNK_CHARS = 50;
export const MIN_CHUNK_REMAINDER_CHARS = 200;
export const MAX_CHARS_TOLERANCE_FACTOR = 1.15;
export const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB
export const EMBEDDING_BATCH_SIZE = 32;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_MIN_SCORE = 0.3;
export const INDEX_DIR = '.mcp-linux/code-index';
export const SHARED_INDEX_BASE_DIR = '/app/data/index-cache';

export const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.java',
  '.kt',
  '.rb',
  '.php',
  '.swift',
  '.cs',
  '.html',
  '.css',
  '.vue',
  '.svelte',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.md',
  '.markdown',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.graphql',
  '.lua',
  '.zig',
  '.scala',
  '.ex',
  '.exs',
]);

export const SUPPORTED_FILENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Vagrantfile',
  'Gemfile',
  'Rakefile',
  '.env.example',
]);

export const DIRS_TO_IGNORE = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  'venv',
  '.venv',
  'dist',
  'build',
  'out',
  'bundle',
  'vendor',
  'target',
  'tmp',
  'temp',
  '.next',
  '.nuxt',
  'coverage',
  'uploads',
  '.mcp-linux',
  '.cache',
  '.idea',
  '.vs',
  'eggs',
  '.eggs',
  'site-packages',
  '.tox',
  '.mypy_cache',
  '.ruff_cache',
  '.pytest_cache',
  'bower_components',
  '.gradle',
]);

export const FILES_TO_IGNORE = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',
  'flake.lock',
  'bun.lockb',
  '.DS_Store',
  'Thumbs.db',
]);
