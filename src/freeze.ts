/**
 * freeze.ts — the rendering pipeline of charmbracelet/freeze main.go: lex the
 * code (or take terminal output), format it as SVG, then add padding,
 * margins, window controls, border, shadow, line numbers and clipping.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { stripAnsi, width as lipglossWidth } from '@oakoliver/lipgloss';
import { Dispatcher, FONT_HEIGHT_TO_WIDTH_RATIO } from './ansi.js';
import { colourString, formatSVG, getStyle, type EmbeddedFont, type Style, type Token } from './chroma.js';
import {
  DEFAULT_OUTPUT_FILENAME, expandMargin, expandPadding, resolveConfig, type Config, type ConfigInput,
} from './config.js';
import { cut } from './cut.js';
import { goFixed, goPadInt } from './fmt.js';
import { jetBrainsMonoBase64 } from './font.js';
import { analyseLexer, getLexer, hljsLanguage, tokenise, type LexerConfig } from './lexer.js';
import {
  addClipPath, addCornerRadius, addOutline, addShadow, getDimensions, move, newWindowControls, setDimensions,
} from './svg.js';
import { wrap } from './wrap.js';
import { XmlElement, type XmlDocument } from './xml.js';

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.2;
const TOP = 0, RIGHT = 1, BOTTOM = 2, LEFT = 3;

/** An error with the title upstream prints in its ERROR banner. */
export class FreezeError extends Error {
  constructor(public title: string, message: string) {
    super(message);
    this.name = 'FreezeError';
  }
}

export type ImageFormat = 'svg' | 'png' | 'webp';

/** Where the text came from: decides how the language is detected. */
export type InputOrigin = 'file' | 'stdin' | 'execute';

export interface RenderSource {
  /** The code or terminal output. */
  text: string;
  origin: InputOrigin;
  /** File name used for language detection when origin is "file". */
  filename?: string;
}

/** The rendered image as an SVG document plus its final size in pixels. */
export interface Rendered {
  document: XmlDocument;
  svg: string;
  width: number;
  height: number;
  /** 4 for auto-sized raster output (upstream renders PNGs at 4x), else 1. */
  scale: number;
  /** Whether the input was treated as ANSI terminal output. */
  ansi: boolean;
  /** The chroma lexer name used, if any. */
  language?: string;
  /** The config after scaling and expansion (what was actually drawn). */
  config: Config;
}

/** Output format from a file name: .png and .webp are raster, anything else SVG. */
export function formatFromPath(path: string): ImageFormat {
  const ext = extname(path).toLowerCase();
  return ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'svg';
}

function fontOptions(config: Config): { fontFamily: string; font?: EmbeddedFont } {
  if (config.font.file) {
    let data: Buffer;
    try {
      data = readFileSync(config.font.file);
    } catch (err) {
      throw new FreezeError('Invalid font options', `invalid font file: ${goErrorMessage(err, config.font.file)}`);
    }
    const ext = extname(config.font.file);
    const format = ({ '.ttf': 'truetype', '.woff2': 'woff2', '.woff': 'woff' } as const)[ext as '.ttf'];
    if (!format) throw new FreezeError('Invalid font options', `${ext} is not a supported font extension`);
    return { fontFamily: config.font.family, font: { base64: data.toString('base64'), format } };
  }
  if (config.font.family !== 'JetBrains Mono') return { fontFamily: config.font.family };
  return {
    fontFamily: 'JetBrains Mono',
    font: { base64: jetBrainsMonoBase64(config.font.ligatures), format: 'truetype' },
  };
}

/** Go's os error text: "open <path>: no such file or directory". */
export function goErrorMessage(err: unknown, path: string): string {
  const e = err as NodeJS.ErrnoException;
  const reasons: Record<string, string> = {
    ENOENT: 'no such file or directory',
    EACCES: 'permission denied',
    EISDIR: 'is a directory',
  };
  if (e?.code === 'EISDIR') return `read ${path}: is a directory`;
  if (e?.code && reasons[e.code]) return `open ${path}: ${reasons[e.code]}`;
  return e?.message ?? String(err);
}

/** The theme's chroma style, with the configured background when the theme has none. */
export function themeStyle(config: Config): Style {
  let style = getStyle(config.theme) ?? getStyle('charm')!;
  if (!style.has('Background')) {
    try {
      style = style.with({ Background: 'bg:' + config.background });
    } catch (err) {
      throw new FreezeError('Could not add background', (err as Error).message);
    }
  }
  return style;
}

/**
 * renderDocument: everything upstream's main() does between reading the input
 * and writing the file. `config` is consumed (scaled and expanded in place).
 */
export function renderDocument(config: Config, source: RenderSource, format: ImageFormat): Rendered {
  const autoHeight = config.height === 0;
  const autoWidth = config.width === 0;
  const scale = autoHeight && autoWidth && format !== 'svg' ? 4 : 1;

  config.margin = expandMargin(config.margin, scale);
  config.padding = expandPadding(config.padding, scale);

  let input = source.text;
  let lexer: LexerConfig | undefined;
  if (source.origin === 'stdin') lexer = analyseLexer(input);
  else if (source.origin === 'execute') config.language = 'ansi';
  else lexer = getLexer(source.filename ?? '');
  if (config.language !== '') lexer = getLexer(config.language);

  // --lines is 1-indexed.
  const lines = config.lines.map((n) => n - 1);
  config.lines = lines;

  let stripped = stripAnsi(input);
  const isAnsi = config.language.toLowerCase() === 'ansi' || stripped !== input;
  stripped = cut(stripped, lines);

  if (config.wrap > 0) {
    stripped = wrap(stripped, config.wrap, '');
    input = wrap(input, config.wrap, '');
  }

  if (!isAnsi && !lexer) {
    throw new FreezeError('Language Unknown', 'specify a language with the --language flag');
  }

  input = cut(input, lines);
  if (input === '') throw new FreezeError('No input', 'check --lines is within bounds');

  const style = themeStyle(config);

  // For ANSI output the formatter only sizes the text; the dispatcher redraws it.
  const tokens: Token[] = isAnsi ? [{ type: 'Text', value: stripped }] : tokenise(input, hljsLanguage(lexer!));
  const document = formatSVG(tokens, style, fontOptions(config));
  const image = document.root;

  const hPadding = config.padding[LEFT] + config.padding[RIGHT];
  const hMargin = config.margin[LEFT] + config.margin[RIGHT];
  const vMargin = config.margin[TOP] + config.margin[BOTTOM];
  const vPadding = config.padding[TOP] + config.padding[BOTTOM];

  const terminal = image.selectElement('rect')!;
  const [w, h] = getDimensions(image);

  let imageWidth = w * scale;
  let imageHeight = h * scale;
  // chroma sizes the image for a 14px font and a 1.2 line height.
  imageHeight *= config.font.size / DEFAULT_FONT_SIZE;
  imageHeight *= config.lineHeight / DEFAULT_LINE_HEIGHT;

  let terminalWidth = imageWidth;
  let terminalHeight = imageHeight;

  if (!autoWidth) {
    imageWidth = config.width;
    terminalWidth = config.width - hMargin;
  } else {
    imageWidth += hMargin + hPadding;
    terminalWidth += hPadding;
  }

  if (!autoHeight) {
    imageHeight = config.height;
    terminalHeight = config.height - vMargin;
  } else {
    imageHeight += vMargin + vPadding;
    terminalHeight += vPadding;
  }

  if (config.window) {
    const controls = newWindowControls(5.5 * scale, 19.0 * scale, 12.0 * scale);
    move(controls, config.margin[LEFT], config.margin[TOP]);
    image.addChild(controls);
    config.padding[TOP] += 15 * scale;
  }

  if (config.border.radius > 0) addCornerRadius(terminal, config.border.radius * scale);

  if (config.shadow.blur > 0 || config.shadow.x > 0 || config.shadow.y > 0) {
    addShadow(image, 'shadow', config.shadow.x * scale, config.shadow.y * scale, config.shadow.blur * scale);
    terminal.setAttr('filter', 'url(#shadow)');
  }

  const textGroup = image.selectElement('g')!;
  textGroup.setAttr('font-size', `${goFixed(config.font.size * scale, 2)}px`);
  textGroup.setAttr('clip-path', 'url(#terminalMask)');
  const text = textGroup.selectElements('text');

  const dispatcher = new Dispatcher(text, textGroup, config, scale);

  const offsetLine = lines.length > 0 ? lines[0] : 0;
  config.lineHeight *= scale;

  const lineNumberFill = colourString(style.get('LineNumbers').colour);
  text.forEach((line, i) => {
    if (isAnsi) line.setText('');
    if (config.showLineNumbers) {
      const ln = new XmlElement('tspan').setAttr('xml:space', 'preserve').setAttr('fill', lineNumberFill);
      ln.setText(`${goPadInt(i + 1 + offsetLine, 3)}  `);
      line.insertChildAt(0, ln);
    }
    const x = config.padding[LEFT] + config.margin[LEFT];
    const y = (i + 1) * (config.font.size * config.lineHeight) + config.padding[TOP] + config.margin[TOP];
    move(line, x, y);
    // Past the visible area: drop the line.
    if (y > imageHeight - config.margin[BOTTOM] - config.padding[BOTTOM]) textGroup.removeChild(line);
  });

  if (autoWidth) {
    const tabWidth = isAnsi ? 6 : 4;
    const longestLine = lipglossWidth(stripped.replaceAll('\t', ' '.repeat(tabWidth)));
    terminalWidth = (longestLine + 1) * (config.font.size / FONT_HEIGHT_TO_WIDTH_RATIO);
    terminalWidth *= scale;
    terminalWidth += hPadding;
    imageWidth = terminalWidth + hMargin;
  }

  if (config.border.width > 0) {
    addOutline(terminal, config.border.width, config.border.color);
    // Keep the outline inside the clip.
    terminalHeight -= config.border.width * 2;
    terminalWidth -= config.border.width * 2;
  }

  if (config.showLineNumbers) {
    if (autoWidth) {
      terminalWidth += config.font.size * 3 * scale;
      imageWidth += config.font.size * 3 * scale;
    } else {
      terminalWidth -= config.font.size * 3;
    }
  }

  if (!autoHeight || !autoWidth) {
    addClipPath(image, 'terminalMask', config.margin[LEFT], config.margin[TOP], terminalWidth,
      terminalHeight - config.padding[BOTTOM]);
  }

  move(terminal, Math.max(config.margin[LEFT], config.border.width / 2), Math.max(config.margin[TOP], config.border.width / 2));
  setDimensions(image, imageWidth, imageHeight);
  setDimensions(terminal, terminalWidth, terminalHeight);

  if (isAnsi) {
    for (const line of input.split('\n')) {
      dispatcher.parse(line);
      dispatcher.execute('\n');
    }
  }

  return {
    document,
    svg: document.toString(),
    width: imageWidth,
    height: imageHeight,
    scale,
    ansi: isAnsi,
    language: lexer?.name,
    config,
  };
}

/** Options for the library API: configuration plus the input. */
export interface FreezeOptions extends ConfigInput {
  /** Code or terminal output to render. */
  code?: string;
  /** A file to read when `code` is not given; also picks the language. */
  file?: string;
  /** Output format; defaults to the extension of `output`, else "svg". */
  format?: ImageFormat;
}

/** Turn library options into a resolved config and a source. */
export function prepare(options: FreezeOptions): { config: Config; source: RenderSource; format: ImageFormat } {
  const { code, file, format: fmt, ...rest } = options;
  const config = resolveConfig(rest);
  let text: string;
  let origin: InputOrigin;
  if (code !== undefined) {
    text = code;
    origin = file ? 'file' : 'stdin';
  } else if (file) {
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      throw new FreezeError('File not found', goErrorMessage(err, file));
    }
    origin = 'file';
  } else {
    throw new FreezeError('No input', 'pass `code` or `file`');
  }
  if (file) config.input = file;
  const format = fmt ?? (config.output ? formatFromPath(config.output) : 'svg');
  if (!config.output) config.output = format === 'svg' ? 'freeze.svg' : `freeze.${format}`;
  return { config, source: { text, origin, filename: file }, format };
}

/**
 * renderSVG: render code or terminal output to an SVG string.
 *
 * ```ts
 * const svg = renderSVG({ file: 'main.go', config: 'full', theme: 'dracula' });
 * ```
 */
export function renderSVG(options: FreezeOptions): string {
  const { config, source } = prepare({ ...options, format: 'svg' });
  return renderDocument(config, source, 'svg').svg;
}

/** render: like renderSVG but returns the size and settings too. */
export function render(options: FreezeOptions): Rendered {
  const { config, source, format } = prepare(options);
  return renderDocument(config, source, format);
}

export { DEFAULT_OUTPUT_FILENAME };
