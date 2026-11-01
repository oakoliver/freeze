/**
 * @oakoliver/freeze — generate images of code and terminal output.
 * A TypeScript port of charmbracelet/freeze.
 */

import { writeFileSync } from 'node:fs';
import { executeCommand, type ExecuteOptions } from './execute.js';
import { prepare, renderDocument, type FreezeOptions, type ImageFormat, type Rendered } from './freeze.js';
import { svgToPNG, svgToPNGAsync, svgToWebP, svgToWebPAsync, type RasterOptions } from './raster.js';

export {
  render, renderSVG, renderDocument, formatFromPath, themeStyle, FreezeError,
} from './freeze.js';
export type { FreezeOptions, ImageFormat, InputOrigin, Rendered, RenderSource } from './freeze.js';

export {
  resolveConfig, zeroConfig, loadPreset, saveUserConfig, userConfigPath, expandPadding, expandMargin,
  BASE_PRESET, FULL_PRESET, PRESETS, DEFAULT_OUTPUT_FILENAME,
} from './config.js';
export type { Config, ConfigInput, BorderConfig, ShadowConfig, FontConfig } from './config.js';

export { executeCommand, parseShellWords, ExecuteError } from './execute.js';
export type { ExecuteOptions } from './execute.js';

export { svgToPNG, svgToWebP, svgToPNGAsync, svgToWebPAsync, rasterize, rasterizeAsync, hasResvg, RasterError } from './raster.js';
export type { RasterOptions, Pixels } from './raster.js';
export { encodeWebP } from './webp.js';

export { getStyle, registerStyle, styleNames, formatSVG, colourString, parseColour, Style } from './chroma.js';
export type { Token, TokenType, StyleEntry, EmbeddedFont, SVGFormatterOptions } from './chroma.js';
export { getLexer, matchLexer, analyseLexer, tokenise, hljsLanguage, languageNames } from './lexer.js';
export type { LexerConfig } from './lexer.js';

export { cut } from './cut.js';
export { wrap } from './wrap.js';
export { FONT_DIR, JETBRAINS_MONO_FILE, JETBRAINS_MONO_NL_FILE } from './font.js';
export { XmlDocument, XmlElement, XmlText } from './xml.js';
export { VERSION } from './version.js';

function rasterOptions(r: Rendered): RasterOptions {
  const { font } = r.config;
  return {
    loadSystemFonts: font.family !== 'JetBrains Mono' || undefined,
    ligatures: font.ligatures,
    fontFiles: font.file && /\.(ttf|otf)$/i.test(font.file) ? [font.file] : undefined,
  };
}

/** The image bytes for a rendered document in the given format. */
export function encode(r: Rendered, format: ImageFormat): Uint8Array {
  if (format === 'png') return svgToPNG(r.svg, rasterOptions(r));
  if (format === 'webp') return svgToWebP(r.svg, rasterOptions(r));
  return new TextEncoder().encode(r.svg);
}

/**
 * renderPNG: render to PNG bytes. Auto-sized images are drawn at 4x, as
 * upstream does. Needs the optional @resvg/resvg-js package (or rsvg-convert).
 */
export function renderPNG(options: FreezeOptions): Uint8Array {
  const { config, source } = prepare({ ...options, format: 'png' });
  return encode(renderDocument(config, source, 'png'), 'png');
}

/** renderWebP: render to lossless WebP bytes (also drawn at 4x when auto-sized). */
export function renderWebP(options: FreezeOptions): Uint8Array {
  const { config, source } = prepare({ ...options, format: 'webp' });
  return encode(renderDocument(config, source, 'webp'), 'webp');
}

/**
 * encodeAsync: like encode, without blocking the event loop while resvg draws
 * (it runs on a worker thread). The bytes are identical to encode's.
 */
export async function encodeAsync(r: Rendered, format: ImageFormat): Promise<Uint8Array> {
  if (format === 'png') return svgToPNGAsync(r.svg, rasterOptions(r));
  if (format === 'webp') return svgToWebPAsync(r.svg, rasterOptions(r));
  return new TextEncoder().encode(r.svg);
}

/**
 * renderPNGAsync: renderPNG that does not block the event loop. Use it in
 * servers; the output is byte-identical to renderPNG's.
 */
export async function renderPNGAsync(options: FreezeOptions): Promise<Uint8Array> {
  const { config, source } = prepare({ ...options, format: 'png' });
  return encodeAsync(renderDocument(config, source, 'png'), 'png');
}

/** renderWebPAsync: renderWebP that does not block the event loop while resvg draws. */
export async function renderWebPAsync(options: FreezeOptions): Promise<Uint8Array> {
  const { config, source } = prepare({ ...options, format: 'webp' });
  return encodeAsync(renderDocument(config, source, 'webp'), 'webp');
}

/**
 * freeze: render and write `options.output` (format from its extension),
 * like the CLI. Returns the path written and the rendered document.
 */
export function freeze(options: FreezeOptions & { output: string }): Rendered & { output: string } {
  const { config, source, format } = prepare(options);
  const r = renderDocument(config, source, format);
  writeFileSync(options.output, encode(r, format));
  return { ...r, output: options.output };
}

/**
 * freezeCommand: run a command in a terminal, capture its output (colours
 * included) and render it, like `freeze --execute`.
 */
export async function freezeCommand(
  command: string,
  options: Omit<FreezeOptions, 'code' | 'file' | 'execute'> & { terminal?: ExecuteOptions } = {},
): Promise<Rendered> {
  const { terminal, ...rest } = options;
  const text = await executeCommand(command, { timeout: rest.executeTimeout, ...terminal });
  const { config, format } = prepare({ ...rest, code: text });
  return renderDocument(config, { text, origin: 'execute' }, format);
}

/** freezeAsync: freeze with the rasterizing off the main thread (the file write stays synchronous but is small). */
export async function freezeAsync(options: FreezeOptions & { output: string }): Promise<Rendered & { output: string }> {
  const { config, source, format } = prepare(options);
  const r = renderDocument(config, source, format);
  writeFileSync(options.output, await encodeAsync(r, format));
  return { ...r, output: options.output };
}
