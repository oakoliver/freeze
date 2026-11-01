/**
 * raster.ts — SVG to PNG and WebP.
 *
 * Upstream converts with `rsvg-convert` when it is installed and otherwise
 * with resvg (through a WebAssembly build). This port prefers resvg through
 * the optional `@resvg/resvg-js` package, loading the bundled JetBrains Mono
 * into resvg's font database as upstream does, and falls back to
 * `rsvg-convert` for PNG. WebP is encoded by webp.ts from resvg's pixels.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { JETBRAINS_MONO_FILE, JETBRAINS_MONO_NL_FILE } from './font.js';
import { encodeWebP } from './webp.js';

export class RasterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RasterError';
  }
}

export interface RasterOptions {
  /** Extra font files (TTF/OTF) for resvg. JetBrains Mono is always loaded. */
  fontFiles?: string[];
  /** Also load system fonts (needed for families other than JetBrains Mono). */
  loadSystemFonts?: boolean;
  /** Family used when the SVG's family is not found. */
  defaultFontFamily?: string;
  /**
   * false draws JetBrains Mono without ligatures. resvg ignores the SVG's
   * @font-face and picks fonts by family name, and the no-ligature file is
   * named "JetBrains Mono NL", so the SVG's family is swapped for rasterizing.
   */
  ligatures?: boolean;
}

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, unpremultiplied. */
  data: Uint8Array;
}

let resvgModule: any | null | undefined;

const MISSING = 'PNG and WebP output need the optional dependency @resvg/resvg-js. ' +
  'Install it with `npm install @resvg/resvg-js` (or `bun add @resvg/resvg-js`), or write an .svg instead.';

function loadResvg(): any | null {
  if (resvgModule !== undefined) return resvgModule;
  try {
    const require = createRequire(import.meta.url || __filename);
    resvgModule = require('@resvg/resvg-js');
  } catch {
    resvgModule = null;
  }
  return resvgModule;
}

declare const __filename: string;

/** Whether @resvg/resvg-js can be loaded. */
export function hasResvg(): boolean {
  return loadResvg() !== null;
}

function resvgInput(input: string, opts: RasterOptions): { mod: any; svg: string; options: Record<string, unknown> } {
  const mod = loadResvg();
  if (!mod) throw new RasterError(MISSING);
  const noLigatures = opts.ligatures === false;
  const svg = noLigatures
    ? input.replaceAll('font-family="JetBrains Mono"', 'font-family="JetBrains Mono NL"')
    : input;
  const family = noLigatures ? 'JetBrains Mono NL' : 'JetBrains Mono';
  const options = {
    dpi: 192,
    shapeRendering: 2, // geometricPrecision
    textRendering: 1, // optimizeLegibility
    imageRendering: 0, // optimizeQuality
    font: {
      fontFiles: [JETBRAINS_MONO_FILE, JETBRAINS_MONO_NL_FILE, ...(opts.fontFiles ?? [])],
      loadSystemFonts: opts.loadSystemFonts ?? false,
      defaultFontFamily: opts.defaultFontFamily ?? family,
      monospaceFamily: family,
    },
  };
  return { mod, svg, options };
}

interface ResvgImage { width: number; height: number; pixels: Uint8Array; png: () => Uint8Array }

function wrapImage(image: any): ResvgImage {
  return {
    width: image.width,
    height: image.height,
    pixels: image.pixels,
    png: () => image.asPng(),
  };
}

function renderResvg(input: string, opts: RasterOptions): ResvgImage {
  const { mod, svg, options } = resvgInput(input, opts);
  return wrapImage(new mod.Resvg(svg, options).render());
}

/** Like renderResvg, but the rasterizing runs on resvg-js's worker thread pool. */
async function renderResvgAsync(input: string, opts: RasterOptions): Promise<ResvgImage> {
  const { mod, svg, options } = resvgInput(input, opts);
  return wrapImage(await mod.renderAsync(svg, options));
}

/** rasterize: render an SVG to RGBA pixels with resvg. */
export function rasterize(svg: string, opts: RasterOptions = {}): Pixels {
  const r = renderResvg(svg, opts);
  return { width: r.width, height: r.height, data: unpremultiply(r.pixels) };
}

/** resvg's pixmap is premultiplied; WebP wants straight alpha. */
function unpremultiply(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3];
    if (a === 255 || a === 0) {
      out[i] = p[i]; out[i + 1] = p[i + 1]; out[i + 2] = p[i + 2];
    } else {
      out[i] = Math.min(255, Math.round((p[i] * 255) / a));
      out[i + 1] = Math.min(255, Math.round((p[i + 1] * 255) / a));
      out[i + 2] = Math.min(255, Math.round((p[i + 2] * 255) / a));
    }
    out[i + 3] = a;
  }
  return out;
}

/** svgToPNG: resvg when available, else `rsvg-convert`, else a RasterError. */
export function svgToPNG(svg: string, opts: RasterOptions = {}): Uint8Array {
  if (hasResvg()) return renderResvg(svg, opts).png();
  const r = spawnSync('rsvg-convert', [], { input: svg, maxBuffer: 1 << 30 });
  if (!r.error && r.status === 0) return new Uint8Array(r.stdout);
  throw new RasterError(MISSING);
}

/** svgToWebP: rasterize with resvg and encode as lossless WebP. */
export function svgToWebP(svg: string, opts: RasterOptions = {}): Uint8Array {
  const { width, height, data } = rasterize(svg, opts);
  return encodeWebP(data, width, height);
}

/** rasterizeAsync: like rasterize, with resvg's rendering off the main thread. */
export async function rasterizeAsync(svg: string, opts: RasterOptions = {}): Promise<Pixels> {
  const r = await renderResvgAsync(svg, opts);
  return { width: r.width, height: r.height, data: unpremultiply(r.pixels) };
}

/** Run `rsvg-convert` without blocking the event loop; null when it is missing or fails. */
function rsvgConvertAsync(svg: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('rsvg-convert', [], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? new Uint8Array(Buffer.concat(chunks)) : null));
    child.stdin.on('error', () => {}); // EPIPE when the program is missing or exits early
    child.stdin.end(svg);
  });
}

/**
 * svgToPNGAsync: like svgToPNG, but resvg renders on a worker thread and the
 * `rsvg-convert` fallback is spawned asynchronously, so the event loop keeps
 * running. The bytes are identical to svgToPNG's.
 */
export async function svgToPNGAsync(svg: string, opts: RasterOptions = {}): Promise<Uint8Array> {
  if (hasResvg()) return (await renderResvgAsync(svg, opts)).png();
  const out = await rsvgConvertAsync(svg);
  if (out) return out;
  throw new RasterError(MISSING);
}

/** svgToWebPAsync: like svgToWebP, with resvg's rendering off the main thread. */
export async function svgToWebPAsync(svg: string, opts: RasterOptions = {}): Promise<Uint8Array> {
  const { width, height, data } = await rasterizeAsync(svg, opts);
  return encodeWebP(data, width, height);
}
