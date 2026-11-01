/**
 * interactive.ts — port of charmbracelet/freeze interactive.go: the
 * `--interactive` form, built with @oakoliver/huh.
 */

import {
  NewConfirm, NewFilePicker, NewForm, NewGroup, NewInput, NewNote, NewOptions, NewSelect, ThemeCharm, ThemeFunc,
  type Styles,
} from '@oakoliver/huh';
import { newStyle } from '@oakoliver/lipgloss';
import { styleNames } from './chroma.js';
import { DEFAULT_OUTPUT_FILENAME, expandPadding, type Config } from './config.js';

const GREEN = '#03BF87';

/** Upstream's tweaks to huh's Charm theme. */
export function freezeTheme(isDark: boolean): Styles {
  const t = ThemeCharm(isDark);
  t.fieldSeparator = newStyle();
  t.blurred.textInput.text = t.blurred.textInput.text.foreground('243');
  t.blurred.blurredButton = newStyle().foreground('8').paddingRight(1);
  t.blurred.focusedButton = newStyle().foreground('7').paddingRight(1);
  t.focused.blurredButton = newStyle().foreground('8').paddingRight(1);
  t.focused.focusedButton = newStyle().foreground('15').paddingRight(1);
  t.focused.noteTitle = t.focused.noteTitle.margin(1, 0);
  t.blurred.noteTitle = t.blurred.noteTitle.margin(1, 0);
  t.blurred.description = t.blurred.description.foreground('0');
  t.focused.description = t.focused.description.foreground('7');
  t.blurred.title = t.blurred.title.width(18).foreground('7');
  t.focused.title = t.focused.title.width(18).foreground(GREEN).bold(true);
  t.blurred.selectedOption = t.blurred.selectedOption.foreground('243');
  t.focused.selectedOption = newStyle().foreground(GREEN);
  // Upstream calls BorderForeground without assigning the result, so the
  // focused border keeps the theme's colour; this port does the same.
  return t;
}

const fieldsOf = (s: string) => s.split(/\s+/).filter(Boolean);

export function validateMargin(s: string): Error | null {
  const tokens = fieldsOf(s);
  if (tokens.length > 4) return new Error('maximum four values');
  for (const t of tokens) if (!/^[+-]?\d+$/.test(t)) return new Error('must be valid space-separated integers');
  return null;
}

export const validatePadding = validateMargin;

export function validateInteger(s: string): Error | null {
  if (s.length <= 0) return null;
  return /^[+-]?\d+$/.test(s) ? null : new Error('must be valid integer');
}

export function validateFloat(s: string): Error | null {
  if (s.length <= 0) return null;
  return s.trim() !== '' && !Number.isNaN(Number(s)) ? null : new Error('must be valid float');
}

export function validateColor(s: string): Error | null {
  if (s.length <= 0) return null;
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(s) ? null : new Error('must be valid color');
}

export function parsePadding(v: string): number[] {
  return expandPadding(fieldsOf(v).map((p) => Number(p) || 0), 1);
}

export const parseMargin = parsePadding;

/** Go's %v of a []float64 without the brackets: "20 40 20 20". */
const list = (v: number[]) => v.map((n) => String(n)).join(' ');
const num = (n: number) => String(Math.round(n));
const parse = (s: string) => {
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * runForm shows the form and returns the edited config. `error` is set when
 * the user aborted (ctrl+c); the config still holds what was entered.
 */
export async function runForm(config: Config): Promise<{ config: Config; error?: Error }> {
  const c = structuredClone(config);
  let padding = list(c.padding);
  let margin = list(c.margin);
  let fontSize = String(Math.trunc(c.font.size));
  let lineHeight = c.lineHeight.toFixed(1);
  let borderRadius = num(c.border.radius);
  let borderWidth = num(c.border.width);
  let shadowBlur = num(c.shadow.blur);
  let shadowX = num(c.shadow.x);
  let shadowY = num(c.shadow.y);

  const form = NewForm(
    NewGroup(
      NewNote().title('\nCapture file'),
      NewFilePicker().title('').picking(true).height(10).value(() => c.input, (v) => { c.input = v; }),
      NewNote().description('Choose a code file to screenshot.'),
    ).withHide(c.input !== '' || c.execute !== ''),
    NewGroup(
      NewNote().title('Settings'),
      NewInput().title('Output').placeholder(DEFAULT_OUTPUT_FILENAME).inline(true).prompt('')
        .value(() => c.output, (v) => { c.output = v; }),
      NewSelect<string>().title('Theme ').inline(true).options(NewOptions(...styleNames()))
        .value(() => c.theme, (v) => { c.theme = v; }),

      NewNote().title('Window'),
      NewInput().title('Padding ').placeholder('20 40').inline(true).prompt('').validate(validatePadding)
        .value(() => padding, (v) => { padding = v; }),
      NewInput().title('Margin ').placeholder('20').inline(true).prompt('').validate(validatePadding)
        .value(() => margin, (v) => { margin = v; }),
      NewConfirm().title('Controls').inline(true).value(() => c.window, (v) => { c.window = v; }),

      NewNote().title('Font'),
      NewInput().title('Font Family ').placeholder('JetBrains Mono').inline(true).prompt('')
        .value(() => c.font.family, (v) => { c.font.family = v; }),
      NewInput().title('Font Size ').placeholder('14').inline(true).prompt('').validate(validateInteger)
        .value(() => fontSize, (v) => { fontSize = v; }),
      NewInput().title('Line Height ').placeholder('1.2').inline(true).prompt('').validate(validateFloat)
        .value(() => lineHeight, (v) => { lineHeight = v; }),

      NewNote().title('Border'),
      NewInput().title('Border Radius ').placeholder('0').inline(true).prompt('').validate(validateInteger)
        .value(() => borderRadius, (v) => { borderRadius = v; }),
      NewInput().title('Border Width ').placeholder('1').inline(true).prompt('').validate(validateInteger)
        .value(() => borderWidth, (v) => { borderWidth = v; }),
      NewInput().title('Border Color ').validate(validateColor).inline(true).prompt('').placeholder('#515151')
        .value(() => c.border.color, (v) => { c.border.color = v; }),

      NewNote().title('Shadow'),
      NewInput().title('Blur ').placeholder('0').inline(true).prompt('').validate(validateInteger)
        .value(() => shadowBlur, (v) => { shadowBlur = v; }),
      NewInput().title('X Offset ').placeholder('0').inline(true).prompt('').validate(validateInteger)
        .value(() => shadowX, (v) => { shadowX = v; }),
      NewInput().title('Y Offset ').placeholder('0').inline(true).prompt('').validate(validateInteger)
        .value(() => shadowY, (v) => { shadowY = v; }),
    ).withHeight(33),
  ).withTheme(ThemeFunc(freezeTheme)).withWidth(40);

  let error: Error | undefined;
  try {
    await form.run();
  } catch (err) {
    error = err as Error;
  }

  if (c.output === '') c.output = DEFAULT_OUTPUT_FILENAME;
  c.padding = parsePadding(padding);
  c.margin = parseMargin(margin);
  c.font.size = parse(fontSize);
  c.lineHeight = parse(lineHeight);
  c.border.radius = parse(borderRadius);
  c.border.width = parse(borderWidth);
  c.shadow.blur = parse(shadowBlur);
  c.shadow.x = parse(shadowX);
  c.shadow.y = parse(shadowY);
  return { config: c, error };
}
