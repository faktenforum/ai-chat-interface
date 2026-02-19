#!/usr/bin/env -S node --experimental-specifier-resolution=node --experimental-strip-types --experimental-transform-types --no-warnings

/**
 * Generate icon variants from assets/icons.
 * Keeps originals unchanged; writes to assets/icons/variants/<variant>/<name>.svg
 *
 * Usage:
 *   ./scripts/generate-icon-variants.ts [options] [--] [icon1.svg [icon2.svg ...]]
 *
 * Options:
 *   --input-dir <path>   Source directory (default: assets/icons)
 *   --output-dir <path>  Output base directory (default: assets/icons/variants)
 *   --variants <list>    Comma-separated variant names (default: all)
 *   --list-variants     Print variant names and exit
 *   --base64 [variant]   Print base64 data URI for first icon (optional variant filter)
 *   --help               Show this help
 *
 * Variants:
 *   green, amber, purple, gray, light, dark  — stroke set to variant color (no background)
 *   green-bg, amber-bg, purple-bg  — full opaque circle background; stroke stays currentColor
 *   light-bg  — light circle background; stroke stays currentColor
 *   dark-bg  — dark circle background; stroke forced to white
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

interface VariantDef {
  stroke: string;
  background: boolean;
  backgroundFill?: string;
  strokeOverride?: boolean;
}

const VARIANTS: Record<string, VariantDef> = {
  green: { stroke: '#059669', background: false },
  amber: { stroke: '#d97706', background: false },
  purple: { stroke: '#ab68ff', background: false },
  gray: { stroke: '#6b7280', background: false },
  light: { stroke: '#ececec', background: false },
  dark: { stroke: '#424242', background: false },
  'green-bg': { stroke: '#059669', background: true },
  'amber-bg': { stroke: '#d97706', background: true },
  'purple-bg': { stroke: '#ab68ff', background: true },
  'light-bg': { stroke: '#000000', background: true, backgroundFill: '#ffffff' },
  'dark-bg': { stroke: '#ffffff', background: true, backgroundFill: '#000000', strokeOverride: true },
};

interface Options {
  inputDir: string;
  outputDir: string;
  variants: string[] | null;
  listVariants: boolean;
  base64: string | null;
  files: string[];
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    inputDir: path.join(ROOT, 'assets', 'icons'),
    outputDir: path.join(ROOT, 'assets', 'icons', 'variants'),
    variants: null,
    listVariants: false,
    base64: null,
    files: [],
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input-dir') options.inputDir = path.resolve(ROOT, args[++i]);
    else if (a === '--output-dir') options.outputDir = path.resolve(ROOT, args[++i]);
    else if (a === '--variants') options.variants = args[++i].split(',').map((s) => s.trim());
    else if (a === '--list-variants') options.listVariants = true;
    else if (a === '--base64') options.base64 = args[i + 1]?.startsWith('-') ? '' : args[++i] ?? '';
    else if (a === '--help' || a === '-h') {
      console.log(`
generate-icon-variants.ts — Generate colored icon variants from assets/icons

Usage:
  ./scripts/generate-icon-variants.ts [options] [--] [icon1.svg ...]

Options:
  --input-dir <path>   Source directory (default: assets/icons)
  --output-dir <path>  Output base (default: assets/icons/variants)
  --variants <list>    Comma-separated: green, amber, purple, gray, light, dark, green-bg, amber-bg, purple-bg, light-bg, dark-bg
  --list-variants      Print variant names and exit
  --base64 [variant]   Print data URI for first icon (optional variant name)
  --help               Show this help

Examples:
  ./scripts/generate-icon-variants.ts
  ./scripts/generate-icon-variants.ts --variants green,amber,purple lock.svg bot.svg
  ./scripts/generate-icon-variants.ts --base64 purple bot-message-square.svg
`);
      process.exit(0);
    } else if (a === '--') {
      options.files = args.slice(i + 1).filter((f) => !f.startsWith('-'));
      break;
    } else if (!a.startsWith('-')) options.files.push(a);
  }
  return options;
}

function applyVariant(svgContent: string, variantName: string): string | null {
  const v = VARIANTS[variantName];
  if (!v) return null;
  let out = svgContent;
  // Apply stroke color for stroke-only variants (green, amber, …) and for dark-bg (strokeOverride)
  const applyStroke = !v.background || v.strokeOverride;
  if (applyStroke) {
    out = out
      .replace(/\bstroke="currentColor"/gi, `stroke="${v.stroke}"`)
      .replace(/\bfill="currentColor"/gi, `fill="${v.stroke}"`);
    if (out.includes('currentColor')) {
      out = out.replace(/currentColor/gi, v.stroke);
    }
  }
  if (v.background) {
    const viewBoxMatch = out.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24';
    const parts = viewBox.split(/\s+/).map(Number);
    const w = parts[2] || 24;
    const h = parts[3] || 24;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy);
    const fill = v.backgroundFill ?? v.stroke;
    const bgGroup = `<g fill="${fill}" stroke="none"><circle cx="${cx}" cy="${cy}" r="${r}"/></g>`;
    const openEnd = out.indexOf('>') + 1;
    const closeSvg = out.lastIndexOf('</svg>');
    out = out.slice(0, openEnd) + bgGroup + out.slice(openEnd, closeSvg) + out.slice(closeSvg);
  }
  return out;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function main(): void {
  const opts = parseArgs();

  if (opts.listVariants) {
    console.log('Variants:', Object.keys(VARIANTS).join(', '));
    process.exit(0);
  }

  const variantNames = opts.variants ?? Object.keys(VARIANTS);
  const invalid = variantNames.filter((n) => !VARIANTS[n]);
  if (invalid.length) {
    console.error('Unknown variants:', invalid.join(', '));
    process.exit(1);
  }

  const inputDir = opts.inputDir;
  let files = opts.files;
  if (files.length === 0) {
    if (!fs.existsSync(inputDir)) {
      console.error('Input dir not found:', inputDir);
      process.exit(1);
    }
    files = fs.readdirSync(inputDir).filter((f) => f.endsWith('.svg'));
  }

  if (opts.base64 !== null) {
    const fileToUse = files[0];
    const firstFile = path.join(inputDir, path.basename(fileToUse));
    if (!fs.existsSync(firstFile)) {
      console.error('File not found:', firstFile);
      process.exit(1);
    }
    let content = fs.readFileSync(firstFile, 'utf8');
    const variant = typeof opts.base64 === 'string' && opts.base64 !== '' ? opts.base64 : variantNames[0];
    const result = applyVariant(content, variant);
    if (!result) {
      console.error('Unknown variant:', variant);
      process.exit(1);
    }
    const minified = result.replace(/\s+/g, ' ').trim();
    const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(minified).toString('base64');
    console.log(dataUri);
    process.exit(0);
  }

  let generated = 0;
  for (const file of files) {
    const base = path.basename(file);
    const inPath = path.join(inputDir, base);
    if (!fs.existsSync(inPath)) {
      console.warn('Skip (not found):', inPath);
      continue;
    }
    const content = fs.readFileSync(inPath, 'utf8');
    for (const variantName of variantNames) {
      const outSvg = applyVariant(content, variantName);
      if (!outSvg) continue;
      const outDir = path.join(opts.outputDir, variantName);
      ensureDir(outDir);
      const outPath = path.join(outDir, base);
      fs.writeFileSync(outPath, outSvg, 'utf8');
      generated++;
    }
  }
  console.log(`Wrote ${generated} variant(s) to ${opts.outputDir}`);
}

main();
