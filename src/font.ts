/**
 * font.ts — the fonts freeze embeds.
 *
 * Like upstream, the package ships JetBrains Mono Regular (with ligatures) and
 * JetBrains Mono NL Regular (no ligatures), © 2020 The JetBrains Mono Project
 * Authors, under the SIL Open Font License 1.1 (fonts/OFL.txt). They are
 * embedded in SVGs as base64 so the image renders the same everywhere, and
 * handed to the rasterizer for PNG and WebP.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __dirname: string | undefined;

/** The package root: one level above dist/ (built) or src/ (source). */
function packageRoot(): string {
  if (typeof __dirname === 'string') return join(__dirname, '..');
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Directory holding the bundled TTF files. */
export const FONT_DIR = join(packageRoot(), 'fonts');

export const JETBRAINS_MONO_FILE = join(FONT_DIR, 'JetBrainsMono-Regular.ttf');
export const JETBRAINS_MONO_NL_FILE = join(FONT_DIR, 'JetBrainsMonoNL-Regular.ttf');

const cache = new Map<string, Buffer>();

export function readFont(path: string): Buffer {
  let data = cache.get(path);
  if (!data) {
    data = readFileSync(path);
    cache.set(path, data);
  }
  return data;
}

/** JetBrains Mono Regular as base64 (with ligatures, or the NL variant). */
export function jetBrainsMonoBase64(ligatures: boolean): string {
  return readFont(ligatures ? JETBRAINS_MONO_FILE : JETBRAINS_MONO_NL_FILE).toString('base64');
}
