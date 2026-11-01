/**
 * chroma.ts — the parts of github.com/alecthomas/chroma/v2 that freeze uses:
 * colours, style entries, style inheritance, the style registry and the SVG
 * formatter. Styles are chroma's own definitions (see chroma-data.ts), so a
 * theme name selects exactly the colours it selects in Go.
 */

import { STYLES, TOKEN_TYPES } from './chroma-data.js';
import { XmlDocument, XmlElement, XmlText } from './xml.js';

// ─── Token types ─────────────────────────────────────────────────────────────

/** A chroma token type name, e.g. "KeywordReserved" or "LiteralStringEscape". */
export type TokenType = string;

/** A lexed token. */
export interface Token {
  type: TokenType;
  value: string;
}

const TYPE_BY_VALUE = new Map<number, string>(Object.entries(TOKEN_TYPES).map(([k, v]) => [v, k]));

function typeValue(t: TokenType): number {
  const v = TOKEN_TYPES[t];
  if (v === undefined) throw new Error(`freeze: unknown chroma token type ${t}`);
  return v;
}

/** TokenType.Category(): t / 1000 * 1000 (Go integer division). */
function category(v: number): number {
  return Math.trunc(v / 1000) * 1000;
}

/** TokenType.SubCategory(): t / 100 * 100. */
function subCategory(v: number): number {
  return Math.trunc(v / 100) * 100;
}

// ─── Colour ──────────────────────────────────────────────────────────────────

const ANSI2RGB: Record<string, string> = {
  '#ansiblack': '000000', '#ansidarkred': '7f0000', '#ansidarkgreen': '007f00', '#ansibrown': '7f7fe0',
  '#ansidarkblue': '00007f', '#ansipurple': '7f007f', '#ansiteal': '007f7f', '#ansilightgray': 'e5e5e5',
  '#ansidarkgray': '555555', '#ansired': 'ff0000', '#ansigreen': '00ff00', '#ansiyellow': 'ffff00',
  '#ansiblue': '0000ff', '#ansifuchsia': 'ff00ff', '#ansiturquoise': '00ffff', '#ansiwhite': 'ffffff',
  '#black': '000000', '#darkred': '7f0000', '#darkgreen': '007f00', '#brown': '7f7fe0',
  '#darkblue': '00007f', '#purple': '7f007f', '#teal': '007f7f', '#lightgray': 'e5e5e5',
  '#darkgray': '555555', '#red': 'ff0000', '#green': '00ff00', '#yellow': 'ffff00',
  '#blue': '0000ff', '#fuchsia': 'ff00ff', '#turquoise': '00ffff', '#white': 'ffffff',
};

/** chroma.Colour: 0 means unset, otherwise RGB + 1. */
export type Colour = number;

export function parseColour(colour: string): Colour {
  let c = ANSI2RGB[colour];
  if (c === undefined) {
    c = colour;
    if (c.startsWith('#')) {
      c = c.slice(1);
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
  }
  if (!/^[0-9a-fA-F]+$/.test(c)) return 0;
  const n = parseInt(c, 16);
  if (n > 0xffffffff) return 0;
  return n + 1;
}

/** Colour.String(): "#%06x" of the stored value minus one (Go formatting). */
export function colourString(c: Colour): string {
  const v = c - 1;
  if (v < 0) return '#-' + (-v).toString(16).padStart(5, '0');
  return '#' + v.toString(16).padStart(6, '0');
}

const red = (c: Colour) => ((c - 1) >> 16) & 0xff;
const green = (c: Colour) => ((c - 1) >> 8) & 0xff;
const blue = (c: Colour) => (c - 1) & 0xff;

function newColour(r: number, g: number, b: number): Colour {
  return ((r & 0xff) << 16 | (g & 0xff) << 8 | (b & 0xff)) + 1;
}

function brightness(c: Colour): number {
  return (red(c) + green(c) + blue(c)) / 255 / 3;
}

function brighten(c: Colour, factor: number): Colour {
  let r = red(c), g = green(c), b = blue(c);
  if (factor < 0) {
    factor++;
    r *= factor; g *= factor; b *= factor;
  } else {
    r = (255 - r) * factor + r;
    g = (255 - g) * factor + g;
    b = (255 - b) * factor + b;
  }
  // uint8(float) truncates toward zero.
  return newColour(Math.trunc(r), Math.trunc(g), Math.trunc(b));
}

function brightenOrDarken(c: Colour, factor: number): Colour {
  return brightness(c) < 0.5 ? brighten(c, factor) : brighten(c, -factor);
}

// ─── Style entries ───────────────────────────────────────────────────────────

/** Trilean: 0 = Pass (inherit), 1 = Yes, 2 = No. */
type Trilean = 0 | 1 | 2;

export interface StyleEntry {
  colour: Colour;
  background: Colour;
  border: Colour;
  bold: Trilean;
  italic: Trilean;
  underline: Trilean;
  noInherit: boolean;
}

const ZERO: StyleEntry = { colour: 0, background: 0, border: 0, bold: 0, italic: 0, underline: 0, noInherit: false };

/** ParseStyleEntry: Pygments-style "bold #ff0000 bg:#000000" descriptions. */
export function parseStyleEntry(entry: string): StyleEntry {
  const out: StyleEntry = { ...ZERO };
  for (const part of entry.split(/\s+/).filter(Boolean)) {
    if (part === 'italic') out.italic = 1;
    else if (part === 'noitalic') out.italic = 2;
    else if (part === 'bold') out.bold = 1;
    else if (part === 'nobold') out.bold = 2;
    else if (part === 'underline') out.underline = 1;
    else if (part === 'nounderline') out.underline = 2;
    else if (part === 'inherit') out.noInherit = false;
    else if (part === 'noinherit') out.noInherit = true;
    else if (part === 'bg:') out.background = 0;
    else if (part.startsWith('bg:#')) {
      out.background = parseColour(part.slice(3));
      if (!out.background) throw new Error(`invalid background colour "${part}"`);
    } else if (part.startsWith('border:#')) {
      out.border = parseColour(part.slice(7));
      if (!out.border) throw new Error(`invalid border colour "${part}"`);
    } else if (part.startsWith('#')) {
      out.colour = parseColour(part);
      if (!out.colour) throw new Error(`invalid colour "${part}"`);
    } else {
      throw new Error(`unknown style element "${part}"`);
    }
  }
  return out;
}

function isZero(e: StyleEntry): boolean {
  return e.colour === 0 && e.background === 0 && e.border === 0 && e.bold === 0 && e.italic === 0 &&
    e.underline === 0 && !e.noInherit;
}

function inherit(s: StyleEntry, ...ancestors: StyleEntry[]): StyleEntry {
  const out = { ...s };
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (out.noInherit) return out;
    const a = ancestors[i];
    if (!out.colour) out.colour = a.colour;
    if (!out.background) out.background = a.background;
    if (!out.border) out.border = a.border;
    if (out.bold === 0) out.bold = a.bold;
    if (out.italic === 0) out.italic = a.italic;
    if (out.underline === 0) out.underline = a.underline;
  }
  return out;
}

function sub(s: StyleEntry, e: StyleEntry): StyleEntry {
  const out: StyleEntry = { ...ZERO };
  if (e.colour !== s.colour) out.colour = s.colour;
  if (e.background !== s.background) out.background = s.background;
  if (e.bold !== s.bold) out.bold = s.bold;
  if (e.italic !== s.italic) out.italic = s.italic;
  if (e.underline !== s.underline) out.underline = s.underline;
  if (e.border !== s.border) out.border = s.border;
  return out;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

/** A chroma style: entries by token type value, with an optional parent. */
export class Style {
  private entries = new Map<number, StyleEntry>();

  constructor(public name: string, entries: Record<string, string>, private parent: Style | null = null) {
    for (const [type, descriptor] of Object.entries(entries)) {
      let entry: StyleEntry;
      try {
        entry = parseStyleEntry(descriptor);
      } catch (err) {
        throw new Error(`invalid entry for ${type}: ${(err as Error).message}`);
      }
      this.entries.set(typeValue(type), entry);
    }
  }

  private raw(t: number): StyleEntry {
    let out = this.entries.get(t) ?? ZERO;
    if (isZero(out) && this.parent) return this.parent.raw(t);
    if (isZero(out) && synthesisable(t)) out = this.synthesise(t);
    return out;
  }

  private synthesise(t: number): StyleEntry {
    const bg = this.raw(TOKEN_TYPES.Background);
    const text = brightenOrDarken(bg.colour, 0.5);
    if (t === TOKEN_TYPES.LineHighlight) return { ...ZERO, background: brightenOrDarken(bg.background, 0.1) };
    if (t === TOKEN_TYPES.LineNumbers || t === TOKEN_TYPES.LineNumbersTable) return { ...ZERO, colour: text };
    return { ...ZERO };
  }

  /** Has: whether the style defines (or can synthesise) an entry for t. */
  has(type: TokenType): boolean {
    const t = typeValue(type);
    return !isZero(this.raw(t)) || synthesisable(t);
  }

  /** Get: the entry for t, inheriting from sub-category, category, Text and Background. */
  get(type: TokenType | number): StyleEntry {
    const t = typeof type === 'number' ? type : typeValue(type);
    return inherit(
      this.raw(t),
      this.raw(TOKEN_TYPES.Background),
      this.raw(TOKEN_TYPES.Text),
      this.raw(category(t)),
      this.raw(subCategory(t)),
    );
  }

  /** Builder().Add(type, entry).Build(): a child style with extra entries. */
  with(entries: Record<string, string>): Style {
    return new Style(this.name, entries, this);
  }
}

function synthesisable(t: number): boolean {
  return t === TOKEN_TYPES.LineHighlight || t === TOKEN_TYPES.LineNumbers || t === TOKEN_TYPES.LineNumbersTable;
}

const registry = new Map<string, Style>();

/** getStyle returns a registered style by (case-insensitive) name, or undefined. */
export function getStyle(name: string): Style | undefined {
  const key = name.toLowerCase();
  let style = registry.get(key);
  if (!style && STYLES[key]) {
    style = new Style(key, STYLES[key]);
    registry.set(key, style);
  }
  return style;
}

/** registerStyle adds a style (Pygments-syntax entries keyed by token type name). */
export function registerStyle(name: string, entries: Record<string, string>): Style {
  const style = new Style(name, entries);
  registry.set(name.toLowerCase(), style);
  return style;
}

/** styleNames: styles.Names(), sorted. */
export function styleNames(): string[] {
  return [...new Set([...Object.keys(STYLES), ...registry.keys()])].sort();
}

// ─── SVG formatter ───────────────────────────────────────────────────────────

const DEFAULT_FONT_FAMILY =
  'Consolas, Monaco, Lucida Console, Liberation Mono, DejaVu Sans Mono, Bitstream Vera Sans Mono, Courier New, monospace';

/** An embedded font for the formatter's @font-face rule. */
export interface EmbeddedFont {
  /** Base64-encoded font data. */
  base64: string;
  /** CSS font format: "truetype", "woff" or "woff2". */
  format: 'truetype' | 'woff' | 'woff2';
}

export interface SVGFormatterOptions {
  fontFamily?: string;
  font?: EmbeddedFont;
}

const MIME: Record<EmbeddedFont['format'], string> = {
  truetype: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

/** Go's len(): UTF-8 byte length. */
export function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** chroma.SplitTokensIntoLines. */
export function splitTokensIntoLines(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let line: Token[] = [];
  for (const tok of tokens) {
    let value = tok.value;
    let emitted = false;
    while (value.includes('\n')) {
      const i = value.indexOf('\n');
      line.push({ type: tok.type, value: value.slice(0, i + 1) });
      out.push(line);
      line = [];
      value = value.slice(i + 1);
      if (value.length === 0) {
        emitted = true;
        break;
      }
    }
    if (!emitted) line.push({ type: tok.type, value });
  }
  if (line.length > 0) out.push(line);
  if (out.length > 0) {
    const last = out[out.length - 1];
    if (last.length === 1 && last[0].value === '') out.pop();
  }
  return out;
}

/** The text chroma's escapeString produces, after etree has decoded it again. */
function svgText(s: string): string {
  return s
    .replaceAll('\r\n', '\n') // encoding/xml rewrites \r\n and lone \r to \n
    .replaceAll('\r', '\n')
    .replaceAll(' ', '\u00a0')
    .replaceAll('\t', '\u00a0\u00a0\u00a0\u00a0');
}

function styleAttrs(e: StyleEntry): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  if (e.colour) attrs.push(['fill', colourString(e.colour)]);
  if (e.bold === 1) attrs.push(['font-weight', 'bold']);
  if (e.italic === 1) attrs.push(['font-style', 'italic']);
  if (e.underline === 1) attrs.push(['text-decoration', 'underline']);
  return attrs;
}

/**
 * formatSVG: chroma's SVG formatter, returning the tree etree would parse from
 * its output. Two deliberate fixes: the font is declared with its real format
 * (upstream labels the TrueType data it embeds as WOFF2), and the stray quote
 * chroma writes after the `src` declaration is gone.
 */
export function formatSVG(tokens: Token[], style: Style, options: SVGFormatterOptions = {}): XmlDocument {
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const lines = splitTokensIntoLines(tokens);

  // styleToSVG + styleAttr lookups, memoised per token type.
  const bg = style.get('Background');
  const attrCache = new Map<number, Array<[string, string]>>();
  const svgStyle = (t: number): Array<[string, string]> | null => {
    let entry = style.get(t);
    if (t !== TOKEN_TYPES.Background) entry = sub(entry, bg);
    return isZero(entry) || !TYPE_BY_VALUE.has(t) ? null : styleAttrs(entry);
  };
  const attrsFor = (type: TokenType): Array<[string, string]> => {
    const t = typeValue(type);
    let cached = attrCache.get(t);
    if (!cached) {
      cached = svgStyle(t) ?? svgStyle(subCategory(t)) ?? svgStyle(category(t)) ?? [];
      attrCache.set(t, cached);
    }
    return cached;
  };

  let maxWidth = 0;
  for (const line of lines) {
    let length = 0;
    for (const tok of line) length += byteLength(tok.value.replaceAll('\t', '    '));
    maxWidth = Math.max(maxWidth, length);
  }

  const svg = new XmlElement('svg')
    .setAttr('width', `${8 * maxWidth}px`)
    .setAttr('height', `${10 + Math.trunc(16.8 * (lines.length + 1))}px`)
    .setAttr('xmlns', 'http://www.w3.org/2000/svg');
  svg.addChild(new XmlText('\n'));

  if (options.font) {
    const { base64, format } = options.font;
    const css = `\n@font-face {\n\tfont-family: '${fontFamily}';\n\tsrc: url(data:${MIME[format]};base64,${base64}) format('${format}');\n\tfont-weight: normal;\n\tfont-style: normal;\n}\n`;
    svg.addChild(new XmlElement('style').addChild(new XmlText(css)));
  }

  svg.addChild(new XmlElement('rect')
    .setAttr('width', '100%')
    .setAttr('height', '100%')
    .setAttr('fill', colourString(style.get('Background').background)));
  svg.addChild(new XmlText('\n'));

  const g = new XmlElement('g')
    .setAttr('font-family', fontFamily)
    .setAttr('font-size', '14px')
    .setAttr('fill', colourString(style.get('Text').colour));
  g.addChild(new XmlText('\n'));
  svg.addChild(g);
  svg.addChild(new XmlText('\n'));

  // writeTokenBackgrounds
  lines.forEach((line, index) => {
    let lineLength = 0;
    for (const tok of line) {
      const length = byteLength(tok.value.replaceAll('\t', '    '));
      const tokenBackground = style.get(tok.type).background;
      if (tokenBackground && tokenBackground !== bg.background) {
        g.addChild(new XmlElement('rect')
          .setAttr('id', svgText(tok.value))
          .setAttr('x', `${lineLength}ch`)
          .setAttr('y', `${(1.2 * index + 0.25).toFixed(6)}em`)
          .setAttr('width', `${length}ch`)
          .setAttr('height', '1.2em')
          .setAttr('fill', colourString(tokenBackground)));
        g.addChild(new XmlText('\n'));
      }
      lineLength += length;
    }
  });

  lines.forEach((line, index) => {
    const text = new XmlElement('text')
      .setAttr('x', '0')
      .setAttr('y', `${(1.2 * (index + 1)).toFixed(6)}em`)
      .setAttr('xml:space', 'preserve');
    let pending = '';
    for (const tok of line) {
      const attrs = attrsFor(tok.type);
      if (attrs.length === 0) {
        pending += svgText(tok.value);
        continue;
      }
      if (pending) text.addChild(new XmlText(pending));
      pending = '';
      const tspan = new XmlElement('tspan');
      tspan.attrs = attrs.map(([k, v]) => [k, v]);
      tspan.addChild(new XmlText(svgText(tok.value)));
      text.addChild(tspan);
    }
    if (pending) text.addChild(new XmlText(pending));
    g.addChild(text);
  });
  g.addChild(new XmlText('\n'));

  return new XmlDocument(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">\n',
    svg,
    '\n',
  );
}
