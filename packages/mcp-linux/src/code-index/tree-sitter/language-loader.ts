// This loader is inspired by Kilo Code's tree-sitter language loader
// (kilocode/src/services/tree-sitter/languageParser.ts),
// licensed under the Apache License, Version 2.0.
// See the upstream LICENSE for full terms.
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Parser as ParserT, Language as LanguageT, Query as QueryT } from 'web-tree-sitter';
import javascriptQuery from './queries/javascript.ts';
import typescriptQuery from './queries/typescript.ts';
import tsxQuery from './queries/tsx.ts';

const require = createRequire(import.meta.url);

export interface LanguageParser {
  [key: string]: {
    parser: ParserT;
    query: QueryT;
  };
}

let isParserInitialized = false;

async function loadLanguage(langName: string): Promise<LanguageT> {
  const wasmPackagePath = require.resolve('tree-sitter-wasms/package.json');
  const wasmDir = path.join(path.dirname(wasmPackagePath), 'out');
  const wasmPath = path.join(wasmDir, `tree-sitter-${langName}.wasm`);

  try {
    const { Language } = require('web-tree-sitter') as typeof import('web-tree-sitter');
    return await (Language as unknown as typeof LanguageT).load(wasmPath);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `Error loading language WASM at ${wasmPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

/**
 * Load tree-sitter parsers for the given files.
 * Currently supports a subset of languages (TS/TSX/JS/JSX/JSON).
 * Returns a map keyed by file extension (without dot).
 */
export async function loadRequiredLanguageParsers(filesToParse: string[]): Promise<LanguageParser> {
  const { Parser, Query } = require('web-tree-sitter') as typeof import('web-tree-sitter');

  if (!isParserInitialized) {
    try {
      await Parser.init();
      isParserInitialized = true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `Error initializing tree-sitter parser: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  const extensionsToLoad = new Set(
    filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)),
  );

  const parsers: LanguageParser = {};

  for (const ext of extensionsToLoad) {
    let language: LanguageT;
    let query: QueryT;
    let parserKey = ext;

    switch (ext) {
      case 'js':
      case 'jsx':
      case 'json':
        language = await loadLanguage('javascript');
        query = new Query(language, javascriptQuery);
        break;
      case 'ts':
        language = await loadLanguage('typescript');
        query = new Query(language, typescriptQuery);
        break;
      case 'tsx':
        language = await loadLanguage('tsx');
        query = new Query(language, tsxQuery);
        break;
      default:
        continue;
    }

    const parser = new Parser();
    parser.setLanguage(language);
    parsers[parserKey] = { parser, query };
  }

  return parsers;
}

