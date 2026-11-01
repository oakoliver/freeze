/**
 * config.ts — port of charmbracelet/freeze config.go: the configuration
 * options, the bundled "base" and "full" presets, the user preset, and the
 * way kong's JSON resolver reads a configuration file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface BorderConfig {
  /** Corner radius of the window. */
  radius: number;
  /** Border width thickness. */
  width: number;
  /** Border colour. */
  color: string;
}

export interface ShadowConfig {
  /** Gaussian blur. */
  blur: number;
  /** Offset x coordinate. */
  x: number;
  /** Offset y coordinate. */
  y: number;
}

export interface FontConfig {
  /** Font family. "JetBrains Mono" embeds the bundled font. */
  family: string;
  /** A .ttf, .woff or .woff2 file to embed instead. */
  file: string;
  /** Font size in pixels. */
  size: number;
  /** Use the ligature variant of the bundled font. */
  ligatures: boolean;
}

/** Config mirrors upstream's Config struct (flag names in comments). */
export interface Config {
  /** Positional argument: the code file ("-" for stdin). */
  input: string;
  /** --background, -b */
  background: string;
  /** --margin, -m: 1, 2 or 4 values (CSS order). */
  margin: number[];
  /** --padding, -p: 1, 2 or 4 values (CSS order). */
  padding: number[];
  /** --window: display window controls. */
  window: boolean;
  /** --width, -W: 0 for automatic. */
  width: number;
  /** --height, -H: 0 for automatic. */
  height: number;
  /** --config, -c: "base", "full", "user", or a JSON file. */
  config: string;
  /** --interactive, -i */
  interactive: boolean;
  /** --language, -l */
  language: string;
  /** --theme, -t: a chroma style name. */
  theme: string;
  /** --wrap, -w: wrap lines at this many cells (0 = off). */
  wrap: number;
  /** --output, -o: .svg, .png or .webp. */
  output: string;
  /** --execute, -x: capture this command's output. */
  execute: string;
  /** --execute.timeout, in milliseconds. */
  executeTimeout: number;
  border: BorderConfig;
  shadow: ShadowConfig;
  font: FontConfig;
  /** --line-height: relative to the font size. */
  lineHeight: number;
  /** --lines: 1-indexed [start] or [start, end]. */
  lines: number[];
  /** --show-line-numbers */
  showLineNumbers: boolean;
}

/** A partial config: nested groups may be partial too. */
export type ConfigInput = Partial<Omit<Config, 'border' | 'shadow' | 'font'>> & {
  border?: Partial<BorderConfig>;
  shadow?: Partial<ShadowConfig>;
  font?: Partial<FontConfig>;
};

export const DEFAULT_OUTPUT_FILENAME = 'freeze.png';

/** Kong's defaults before any configuration file is applied. */
export function zeroConfig(): Config {
  return {
    input: '',
    background: '',
    margin: [],
    padding: [],
    window: false,
    width: 0,
    height: 0,
    config: 'default',
    interactive: false,
    language: '',
    theme: '',
    wrap: 0,
    output: '',
    execute: '',
    executeTimeout: 10_000,
    border: { radius: 0, width: 0, color: '' },
    shadow: { blur: 0, x: 0, y: 0 },
    font: { family: '', file: '', size: 0, ligatures: false },
    lineHeight: 0,
    lines: [],
    showLineNumbers: false,
  };
}

/** configurations/base.json */
export const BASE_PRESET = {
  window: false,
  theme: 'charm',
  border: { radius: 0, width: 0, color: '#515151' },
  shadow: { blur: 0, x: 0, y: 0 },
  padding: [20, 40, 20, 20],
  margin: '0',
  background: '#171717',
  font: { family: 'JetBrains Mono', size: 14, ligatures: true },
  line_height: 1.2,
};

/** configurations/full.json */
export const FULL_PRESET = {
  window: true,
  theme: 'charm',
  border: { radius: 8, width: 1, color: '#515151' },
  shadow: { blur: 24, x: 0, y: 12 },
  padding: [20, 40, 20, 20],
  margin: [50, 60, 70, 60],
  background: '#171717',
  font: { family: 'JetBrains Mono', size: 14, ligatures: true },
  line_height: 1.2,
};

export const PRESETS: Record<string, Record<string, unknown>> = { base: BASE_PRESET, full: FULL_PRESET };

/** Where adrg/xdg puts the configuration directory on this platform. */
export function configHome(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(homedir(), '.config');
}

/** $XDG_CONFIG_HOME/freeze/user.json, written by interactive mode. */
export function userConfigPath(): string {
  return join(configHome(), 'freeze', 'user.json');
}

// ─── Flags and the JSON resolver ─────────────────────────────────────────────

export type FlagKind = 'string' | 'bool' | 'number' | 'int' | 'list' | 'intlist' | 'duration';

export interface FlagSpec {
  name: string;
  short?: string;
  kind: FlagKind;
  help: string;
  group: 'Settings' | 'Window' | 'Border' | 'Shadow' | 'Font' | 'Line';
  hidden?: boolean;
  negatable?: boolean;
  get: (c: Config) => unknown;
  set: (c: Config, v: any) => void;
}

/** Upstream's flags in declaration order (kong derives help order from it). */
export const FLAGS: FlagSpec[] = [
  { name: 'background', short: 'b', kind: 'string', group: 'Window', help: 'Apply a background fill.', get: (c) => c.background, set: (c, v) => { c.background = v; } },
  { name: 'margin', short: 'm', kind: 'list', group: 'Window', help: 'Apply margin to the window.', get: (c) => c.margin, set: (c, v) => { c.margin = v; } },
  { name: 'padding', short: 'p', kind: 'list', group: 'Window', help: 'Apply padding to the code.', get: (c) => c.padding, set: (c, v) => { c.padding = v; } },
  { name: 'window', kind: 'bool', group: 'Window', help: 'Display window controls.', get: (c) => c.window, set: (c, v) => { c.window = v; } },
  { name: 'width', short: 'W', kind: 'number', group: 'Window', help: 'Width of terminal window.', get: (c) => c.width, set: (c, v) => { c.width = v; } },
  { name: 'height', short: 'H', kind: 'number', group: 'Window', help: 'Height of terminal window.', get: (c) => c.height, set: (c, v) => { c.height = v; } },
  { name: 'version', short: 'v', kind: 'bool', group: 'Settings', help: "Display Freeze's version.", get: () => false, set: () => {} },
  { name: 'config', short: 'c', kind: 'string', group: 'Settings', help: 'Base configuration file or template.', get: (c) => c.config, set: (c, v) => { c.config = v; } },
  { name: 'interactive', short: 'i', kind: 'bool', group: 'Settings', hidden: true, help: 'Use an interactive form for configuration options.', get: (c) => c.interactive, set: (c, v) => { c.interactive = v; } },
  { name: 'language', short: 'l', kind: 'string', group: 'Settings', help: 'Language of code file.', get: (c) => c.language, set: (c, v) => { c.language = v; } },
  { name: 'theme', short: 't', kind: 'string', group: 'Settings', help: 'Theme to use for syntax highlighting.', get: (c) => c.theme, set: (c, v) => { c.theme = v; } },
  { name: 'wrap', short: 'w', kind: 'int', group: 'Settings', help: 'Wrap lines at a specific width.', get: (c) => c.wrap, set: (c, v) => { c.wrap = v; } },
  { name: 'output', short: 'o', kind: 'string', group: 'Settings', help: 'Output location for {{.svg}}, {{.png}}, or {{.webp}}.', get: (c) => c.output, set: (c, v) => { c.output = v; } },
  { name: 'execute', short: 'x', kind: 'string', group: 'Settings', help: 'Capture output of command execution.', get: (c) => c.execute, set: (c, v) => { c.execute = v; } },
  { name: 'execute.timeout', kind: 'duration', group: 'Settings', hidden: true, help: 'Execution timeout.', get: (c) => c.executeTimeout, set: (c, v) => { c.executeTimeout = v; } },
  { name: 'border.radius', short: 'r', kind: 'number', group: 'Border', help: 'Corner radius of window.', get: (c) => c.border.radius, set: (c, v) => { c.border.radius = v; } },
  { name: 'border.width', kind: 'number', group: 'Border', help: 'Border width thickness.', get: (c) => c.border.width, set: (c, v) => { c.border.width = v; } },
  { name: 'border.color', kind: 'string', group: 'Border', help: 'Border color.', get: (c) => c.border.color, set: (c, v) => { c.border.color = v; } },
  { name: 'shadow.blur', kind: 'number', group: 'Shadow', help: 'Shadow Gaussian Blur.', get: (c) => c.shadow.blur, set: (c, v) => { c.shadow.blur = v; } },
  { name: 'shadow.x', kind: 'number', group: 'Shadow', help: 'Shadow offset {{x}} coordinate.', get: (c) => c.shadow.x, set: (c, v) => { c.shadow.x = v; } },
  { name: 'shadow.y', kind: 'number', group: 'Shadow', help: 'Shadow offset {{y}} coordinate.', get: (c) => c.shadow.y, set: (c, v) => { c.shadow.y = v; } },
  { name: 'font.family', kind: 'string', group: 'Font', help: 'Font family to use for code.', get: (c) => c.font.family, set: (c, v) => { c.font.family = v; } },
  { name: 'font.file', kind: 'string', group: 'Font', help: 'Font file to embed.', get: (c) => c.font.file, set: (c, v) => { c.font.file = v; } },
  { name: 'font.size', kind: 'number', group: 'Font', help: 'Font size to use for code.', get: (c) => c.font.size, set: (c, v) => { c.font.size = v; } },
  { name: 'font.ligatures', kind: 'bool', group: 'Font', negatable: true, help: 'Use ligatures in the font.', get: (c) => c.font.ligatures, set: (c, v) => { c.font.ligatures = v; } },
  { name: 'line-height', kind: 'number', group: 'Line', help: 'Line height relative to font size.', get: (c) => c.lineHeight, set: (c, v) => { c.lineHeight = v; } },
  { name: 'lines', kind: 'intlist', group: 'Line', help: 'Lines to capture (start,end).', get: (c) => c.lines, set: (c, v) => { c.lines = v; } },
  { name: 'show-line-numbers', kind: 'bool', group: 'Line', help: '', get: (c) => c.showLineNumbers, set: (c, v) => { c.showLineNumbers = v; } },
];

/** Go's time.ParseDuration, in milliseconds. */
export function parseDuration(s: string): number {
  if (s === '0') return 0;
  const re = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|ms|s|m|h)/g;
  const units: Record<string, number> = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  let total = 0;
  let consumed = 0;
  let sign = 1;
  let body = s;
  if (body.startsWith('-') || body.startsWith('+')) {
    sign = body[0] === '-' ? -1 : 1;
    body = body.slice(1);
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index !== consumed) break;
    total += parseFloat(m[1]) * units[m[2]];
    consumed += m[0].length;
  }
  if (consumed !== body.length || consumed === 0) throw new Error(`time: invalid duration "${s}"`);
  return sign * total;
}

function parseNumber(flag: string, raw: string): number {
  const n = Number(raw.trim());
  if (raw.trim() === '' || Number.isNaN(n)) throw new Error(`--${flag}: expected a number but got "${raw}"`);
  return n;
}

/** Decode a flag value (from the command line or a JSON resolver) into its type. */
export function decodeFlag(spec: FlagSpec, value: unknown): unknown {
  const name = spec.name;
  switch (spec.kind) {
    case 'string':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      throw new Error(`--${name}: expected a string`);
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === '1') return true;
      if (value === 'false' || value === '0') return false;
      throw new Error(`--${name}: bool value must be true, 1, yes, false, 0 or no but got "${value}"`);
    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') return parseNumber(name, value);
      throw new Error(`--${name}: expected a number`);
    case 'int': {
      const n = typeof value === 'number' ? value : parseNumber(name, String(value));
      if (!Number.isInteger(n)) throw new Error(`--${name}: expected an int but got "${value}"`);
      return n;
    }
    case 'duration':
      if (typeof value === 'number') return value / 1e6; // a JSON number is nanoseconds
      return parseDuration(String(value));
    case 'list':
    case 'intlist': {
      const items = Array.isArray(value) ? value : String(value).split(',').filter((s) => s !== '');
      return items.map((v) => {
        const n = typeof v === 'number' ? v : parseNumber(name, String(v));
        if (spec.kind === 'intlist' && !Number.isInteger(n)) throw new Error(`--${name}: expected an int`);
        return n;
      });
    }
  }
}

/** kong's snakeCase (which actually produces camelCase): "line-height" -> "lineHeight". */
function camel(name: string): string {
  const titled = name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return titled.charAt(0).toLowerCase() + titled.slice(1);
}

/** kong.JSON: resolve one flag from a decoded JSON configuration. */
export function resolveJSON(values: Record<string, unknown>, flag: string): unknown {
  const name = flag.replaceAll('-', '_');
  if (name in values) return values[name];
  const camelName = camel(flag);
  if (camelName in values) return values[camelName];
  let raw: unknown = values;
  for (const part of name.split('.')) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && part in (raw as object)) {
      raw = (raw as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return raw;
}

/** Apply every flag a JSON configuration sets. */
export function applyJSON(config: Config, values: Record<string, unknown>): void {
  for (const spec of FLAGS) {
    const v = resolveJSON(values, spec.name);
    if (v === undefined || v === null) continue;
    spec.set(config, decodeFlag(spec, v));
  }
}

/**
 * loadPreset resolves --config the way upstream does: a bundled preset name,
 * "user" for the saved user preset, otherwise a JSON file path; anything that
 * cannot be opened falls back to "base".
 */
export function loadPreset(name: string): Record<string, unknown> {
  if (PRESETS[name]) return structuredClone(PRESETS[name]);
  let text: string | undefined;
  if (name === 'user' && existsSync(userConfigPath())) text = readFileSync(userConfigPath(), 'utf8');
  else if (existsSync(name)) {
    try {
      text = readFileSync(name, 'utf8');
    } catch {
      text = undefined;
    }
  }
  if (text === undefined) return structuredClone(BASE_PRESET);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (err) {
    throw new InvalidJSONError((err as Error).message);
  }
}

export class InvalidJSONError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJSONError';
  }
}

/** expandPadding: 1, 2 or 4 values to [top, right, bottom, left], scaled. */
export function expandPadding(p: number[], scale: number): number[] {
  switch (p.length) {
    case 1: return [p[0] * scale, p[0] * scale, p[0] * scale, p[0] * scale];
    case 2: return [p[0] * scale, p[1] * scale, p[0] * scale, p[1] * scale];
    case 4: return [p[0] * scale, p[1] * scale, p[2] * scale, p[3] * scale];
    default: return [0, 0, 0, 0];
  }
}

export const expandMargin = expandPadding;

/** The JSON upstream writes for a Config (Go field order and json tags). */
export function configToJSON(c: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (c.input) out.Input = c.input;
  Object.assign(out, {
    background: c.background,
    margin: c.margin,
    padding: c.padding,
    window: c.window,
    width: c.width,
    height: c.height,
    version: false,
  });
  if (c.config) out.config = c.config;
  if (c.interactive) out.Interactive = c.interactive;
  if (c.language) out.language = c.language;
  out.theme = c.theme;
  out.wrap = c.wrap;
  if (c.output) out.output = c.output;
  Object.assign(out, {
    border: { ...c.border },
    shadow: { ...c.shadow },
    font: { ...c.font },
    line_height: c.lineHeight,
    show_line_numbers: c.showLineNumbers,
  });
  return out;
}

/** saveUserConfig writes the interactive choices to the user preset. */
export function saveUserConfig(config: Config): string {
  const path = userConfigPath();
  const c = structuredClone(config);
  c.input = '';
  c.output = '';
  c.interactive = false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(configToJSON(c)));
  return path;
}

/**
 * resolveConfig builds a full Config the way the CLI does: kong's zero values,
 * then the preset (`options.config`, default "base"), then the given options.
 */
export function resolveConfig(options: ConfigInput = {}): Config {
  const config = zeroConfig();
  const preset = options.config ?? 'default';
  applyJSON(config, loadPreset(preset));
  config.config = preset;
  const { border, shadow, font, ...rest } = options;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) (config as any)[k] = Array.isArray(v) ? [...v] : v;
  if (border) Object.assign(config.border, stripUndefined(border));
  if (shadow) Object.assign(config.shadow, stripUndefined(shadow));
  if (font) Object.assign(config.font, stripUndefined(font));
  return config;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
