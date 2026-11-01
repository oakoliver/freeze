/**
 * social-cards — render a whole set of README and social images in one go.
 *
 * Every entry below names a code sample, a theme and a size. Fixed-size
 * images (e.g. 1200×630 for Open Graph cards) are drawn at 1x, so the PNG is
 * exactly that size; the window is centred with margins, and the code is cut
 * to the lines that fit. Auto-sized images are drawn at 4x, as upstream does.
 *
 * Usage:
 *   bun examples/social-cards.ts [--out dir] [--webp]
 *
 * Writes the images plus manifest.json (file, size, bytes, render time).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { encode, render, type FreezeOptions, type ImageFormat } from '../src/index.ts';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1]! : 'cards';
const RASTER: ImageFormat = args.includes('--webp') ? 'webp' : 'png';

interface Card {
  /** Output name, without extension. */
  name: string;
  file: string;
  theme: string;
  /** Pixel size; omit for an auto-sized (4x) image. */
  size?: [number, number];
  /** Lines to show; with a fixed size, defaults to the lines that fit. */
  lines?: [number, number];
  extra?: Partial<FreezeOptions>;
}

const CARDS: Card[] = [
  { name: 'og-go', file: 'examples/samples/fib.go', theme: 'catppuccin-mocha', size: [1200, 630] },
  { name: 'og-rust', file: 'examples/samples/lib.rs', theme: 'tokyonight-night', size: [1200, 630] },
  { name: 'og-python', file: 'examples/samples/pipeline.py', theme: 'dracula', size: [1200, 630] },
  { name: 'og-typescript', file: 'examples/samples/server.ts', theme: 'github-dark', size: [1200, 630] },
  { name: 'square-yaml', file: 'examples/samples/deploy.yaml', theme: 'nord', size: [1080, 1080], extra: { font: { size: 30 } } },
  { name: 'readme-go', file: 'examples/samples/fib.go', theme: 'charm', lines: [8, 16], extra: { showLineNumbers: true } },
  { name: 'readme-rust-light', file: 'examples/samples/lib.rs', theme: 'github', lines: [3, 14], extra: { background: '#ffffff', border: { color: '#d0d7de' } } },
];

const MARGIN = 60;
const PADDING = [24, 40, 24, 32];

/** How many lines of code fit in a fixed-height window. */
function linesThatFit(height: number, fontSize: number, lineHeight: number, window: boolean): number {
  const chrome = 2 * MARGIN + PADDING[0]! + PADDING[2]! + (window ? 15 : 0);
  return Math.max(1, Math.floor((height - chrome) / (fontSize * lineHeight)) - 1);
}

mkdirSync(OUT, { recursive: true });
const manifest: Array<Record<string, unknown>> = [];
const t0 = performance.now();

for (const card of CARDS) {
  const start = performance.now();
  // Fixed-size cards are viewed small (link previews): use a bigger font.
  const fontSize = card.extra?.font?.size ?? (card.size ? 24 : 14);
  let lines = card.lines;
  if (!lines && card.size) {
    const total = readFileSync(card.file, 'utf8').replace(/\n$/, '').split('\n').length;
    lines = [1, Math.min(total, linesThatFit(card.size[1], fontSize, 1.2, true))];
  }
  const options: FreezeOptions = {
    file: card.file,
    config: 'full',
    theme: card.theme,
    margin: [MARGIN],
    padding: PADDING,
    ...(card.size ? { width: card.size[0], height: card.size[1] } : {}),
    ...(lines ? { lines } : {}),
    ...card.extra,
    font: { ...card.extra?.font, size: fontSize },
    format: RASTER,
  };
  const rendered = render(options);
  const bytes = encode(rendered, RASTER);
  const out = join(OUT, `${card.name}.${RASTER}`);
  writeFileSync(out, bytes);
  const ms = Math.round(performance.now() - start);
  const size = `${Math.round(rendered.width)}×${Math.round(rendered.height)}`;
  manifest.push({ file: out, source: basename(card.file), language: rendered.language, theme: card.theme, size, scale: rendered.scale, bytes: bytes.length, ms });
  console.log(`${out.padEnd(28)} ${extname(card.file).slice(1).padEnd(5)} ${card.theme.padEnd(18)} ${size.padEnd(11)} ${String(rendered.scale) + 'x'}  ${(bytes.length / 1024).toFixed(0).padStart(4)} KB  ${String(ms).padStart(4)} ms`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${CARDS.length} images in ${Math.round(performance.now() - t0)} ms → ${OUT}/ (manifest.json)`);
