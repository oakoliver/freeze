/**
 * Snapshot Studio — a full-screen freeze front end built with
 * @oakoliver/bubbletea, @oakoliver/bubbles and @oakoliver/lipgloss.
 *
 * Browse a directory's source files, preview the highlighted code in the
 * terminal with the theme, window, line numbers, shadow and line range you
 * pick, and export the image (SVG, PNG or WebP) with @oakoliver/freeze.
 *
 * Usage:
 *   bun examples/studio.ts [dir]            browse dir (default: examples/samples)
 *   bun examples/studio.ts [dir] --out D    write images to D (default: ./freeze-out)
 *
 * Keys:
 *   tab        switch between the file list and the options
 *   ↑/↓ j/k    move in the focused pane
 *   ←/→ h/l    change the selected option (themes too)  ·  t/T next/previous theme anywhere
 *   space      toggle the selected option
 *   /          filter files (enter keeps, esc clears)
 *   pgup/pgdn  scroll the preview
 *   e / enter  export the image          ·  q quit
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import {
  NewProgram, View, Quit, Batch, WindowSizeMsg, KeyPressMsg, MouseWheelMsg, MouseMode, MouseButton,
} from '@oakoliver/bubbletea';
import type { Cmd, Msg } from '@oakoliver/bubbletea';
import { newStyle, stringWidth, truncate, joinHorizontal, Top } from '@oakoliver/lipgloss';
import {
  newTextInput, textInputDefaultDarkStyles, newHelp, newBinding, withKeys, withHelp, matches,
  newSpinner, withSpinner, withSpinnerStyle, MiniDot,
} from '@oakoliver/bubbles';
import type { Binding } from '@oakoliver/bubbles';
import {
  colourString, encode, getLexer, getStyle, hljsLanguage, render, styleNames, tokenise, type Rendered,
} from '../src/index.ts';

// ── arguments ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT_DIR = outIdx >= 0 ? argv[outIdx + 1]! : 'freeze-out';
const ROOT = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') ?? 'examples/samples';

// ── palette ────────────────────────────────────────────────────────────────
const C = {
  violet: '#7D56F4', pink: '#EE6FF8', green: '#04D98B', amber: '#FFB454', red: '#FF5F87',
  text: '#D6D6E7', dim: '#6C6C88', faint: '#3A3A4E', panel: '#1A1A24', sel: '#2B2347', ink: '#0B0B14',
};
interface Sty { fg?: string; bg?: string; b?: boolean; i?: boolean; u?: boolean }
const S = (text: string, o: Sty = {}): string => {
  if (!text) return '';
  let s = newStyle().inline(true);
  if (o.fg) s = s.foreground(o.fg);
  if (o.bg) s = s.background(o.bg);
  if (o.b) s = s.bold(true);
  if (o.i) s = s.italic(true);
  if (o.u) s = s.underline(true);
  return s.render(text);
};
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - stringWidth(s)));
const fit = (s: string, w: number) => (w <= 0 ? '' : stringWidth(s) > w ? truncate(s, w - 1) + '…' : s);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ── files ──────────────────────────────────────────────────────────────────
interface SourceFile { path: string; rel: string; language: string; lines: string[] }

function scan(dir: string, depth = 0, out: SourceFile[] = []): SourceFile[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir).sort(); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (st.isDirectory()) { if (depth < 3) scan(path, depth + 1, out); continue; }
    if (st.size > 200_000) continue;
    const lexer = getLexer(path);
    if (!lexer || lexer.name === 'plaintext') continue;
    const text = readFileSync(path, 'utf8');
    out.push({ path, rel: relative(ROOT, path), language: lexer.name, lines: text.replace(/\n$/, '').split('\n') });
    if (out.length >= 400) break;
  }
  return out;
}

// ── options ────────────────────────────────────────────────────────────────
const THEMES = styleNames();
const PADDINGS: number[][] = [[20, 40, 20, 20], [10, 20, 10, 20], [30, 50, 30, 30], [0, 0, 0, 0]];
const FORMATS = ['png', 'svg', 'webp'] as const;
type Format = (typeof FORMATS)[number];

interface Options {
  theme: number; window: boolean; lineNumbers: boolean; shadow: boolean; radius: number;
  padding: number; start: number; end: number; format: Format; fontSize: number;
}

type OptKey = 'theme' | 'window' | 'lineNumbers' | 'shadow' | 'radius' | 'padding' | 'start' | 'end' | 'fontSize' | 'format';
const OPTION_ROWS: Array<{ key: OptKey; label: string; hint: string }> = [
  { key: 'theme', label: 'Theme', hint: `${THEMES.length} chroma styles` },
  { key: 'window', label: 'Window', hint: 'traffic-light controls' },
  { key: 'lineNumbers', label: 'Line numbers', hint: '' },
  { key: 'shadow', label: 'Shadow', hint: 'blur 24, offset 0,12' },
  { key: 'radius', label: 'Radius', hint: 'corner radius' },
  { key: 'padding', label: 'Padding', hint: 'top right bottom left' },
  { key: 'start', label: 'First line', hint: '--lines start' },
  { key: 'end', label: 'Last line', hint: '--lines end (0 = last)' },
  { key: 'fontSize', label: 'Font size', hint: 'px' },
  { key: 'format', label: 'Format', hint: 'png and webp at 4x' },
];

// ── keys ───────────────────────────────────────────────────────────────────
const bind = (keys: string[], key: string, desc: string): Binding => newBinding(withKeys(...keys), withHelp(key, desc));
const keys = {
  up: bind(['up', 'k'], '↑/↓', 'move'), down: bind(['down', 'j'], '↓', 'down'),
  left: bind(['left', 'h'], '←/→', 'change'), right: bind(['right', 'l'], '→', 'right'),
  tab: bind(['tab', 'shift+tab'], 'tab', 'pane'), toggle: bind(['space'], 'space', 'toggle'),
  theme: bind(['t'], 't/T', 'theme'), themeBack: bind(['T'], 'T', 'theme back'),
  filter: bind(['/'], '/', 'filter'), export: bind(['e', 'enter'], 'e', 'export'),
  pgup: bind(['pgup'], 'pgup/pgdn', 'scroll'), pgdown: bind(['pgdown'], 'pgdn', 'scroll'),
  quit: bind(['q', 'ctrl+c'], 'q', 'quit'),
};

// ── messages ───────────────────────────────────────────────────────────────
interface ExportedMsg { _tag: 'exported'; path?: string; bytes?: number; ms?: number; size?: string; error?: string }

// ── the model ──────────────────────────────────────────────────────────────
class Studio {
  width = 0;
  height = 0;
  files: SourceFile[] = scan(ROOT);
  visible: SourceFile[] = this.files;
  cursor = 0;
  listTop = 0;
  focus: 'files' | 'options' = 'files';
  opt = 0;
  scroll = 0;
  filtering = false;
  filterInput = newTextInput();
  help = newHelp();
  spinner = newSpinner(withSpinner(MiniDot), withSpinnerStyle(newStyle().foreground(C.pink)));
  exporting = false;
  status = `${this.files.length} files in ${ROOT}`;
  statusColor = C.dim;
  o: Options = {
    theme: Math.max(0, THEMES.indexOf('charm')), window: true, lineNumbers: false, shadow: true, radius: 8,
    padding: 0, start: 1, end: 0, format: 'png', fontSize: 14,
  };
  private measured: { key: string; r: Rendered | null; err?: string } = { key: '', r: null };

  constructor() {
    const s = textInputDefaultDarkStyles();
    for (const state of [s.focused, s.blurred]) {
      state.text = newStyle().foreground(C.text);
      state.placeholder = newStyle().foreground(C.dim);
      state.prompt = newStyle().foreground(C.pink).bold(true);
    }
    s.cursor = { ...s.cursor, color: C.pink, blink: false };
    this.filterInput.setStyles(s);
    this.filterInput.prompt = '/ ';
    this.filterInput.placeholder = 'filter files';
    this.filterInput.setWidth(22);
    this.help.styles.shortKey = newStyle().foreground(C.text).bold(true);
    this.help.styles.shortDesc = newStyle().foreground(C.dim);
    this.help.styles.shortSeparator = newStyle().foreground(C.faint);
  }

  get file(): SourceFile | undefined { return this.visible[this.cursor]; }

  init(): Cmd { return null; }

  update(msg: Msg): [Studio, Cmd] {
    if (msg instanceof WindowSizeMsg) {
      this.width = msg.width;
      this.height = msg.height;
      return [this, null];
    }
    if ((msg as ExportedMsg)?._tag === 'exported') {
      const m = msg as ExportedMsg;
      this.exporting = false;
      if (m.error) { this.status = `✗ ${m.error}`; this.statusColor = C.red; }
      else {
        this.status = `✓ wrote ${m.path}  ·  ${m.size}  ·  ${(m.bytes! / 1024).toFixed(0)} KB  ·  ${m.ms} ms`;
        this.statusColor = C.green;
      }
      return [this, null];
    }
    if ((msg as { type?: string })?.type === 'spinner.tick') {
      if (!this.exporting) return [this, null];
      const [s, c] = this.spinner.update(msg);
      this.spinner = s;
      return [this, c];
    }
    if (msg instanceof MouseWheelMsg) {
      this.scroll = Math.max(0, this.scroll + (msg.button === MouseButton.WheelUp ? -3 : 3));
      return [this, null];
    }
    if (!(msg instanceof KeyPressMsg)) return [this, null];
    if (this.filtering) return this.updateFilter(msg);
    return this.updateKeys(msg);
  }

  private updateFilter(msg: KeyPressMsg): [Studio, Cmd] {
    const key = msg.toString();
    if (key === 'esc') {
      this.filterInput.setValue('');
      this.applyFilter();
      this.filtering = false;
      this.filterInput.blur();
      return [this, null];
    }
    if (key === 'enter') {
      this.filtering = false;
      this.filterInput.blur();
      return [this, null];
    }
    const [, c] = this.filterInput.update(msg);
    this.applyFilter();
    return [this, c];
  }

  private applyFilter(): void {
    const q = this.filterInput.value().toLowerCase();
    this.visible = q ? this.files.filter((f) => f.rel.toLowerCase().includes(q) || f.language.toLowerCase().includes(q)) : this.files;
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.visible.length - 1));
    this.resetFile();
  }

  private resetFile(): void {
    this.scroll = 0;
    this.o.start = 1;
    this.o.end = 0;
  }

  private updateKeys(msg: KeyPressMsg): [Studio, Cmd] {
    if (matches(msg, keys.quit)) return [this, Quit];
    if (matches(msg, keys.tab)) { this.focus = this.focus === 'files' ? 'options' : 'files'; return [this, null]; }
    if (matches(msg, keys.filter)) {
      this.filtering = true;
      this.focus = 'files';
      return [this, this.filterInput.focus()];
    }
    if (matches(msg, keys.theme)) { this.change('theme', 1); return [this, null]; }
    if (matches(msg, keys.themeBack)) { this.change('theme', -1); return [this, null]; }
    if (matches(msg, keys.pgup)) { this.scroll = Math.max(0, this.scroll - 10); return [this, null]; }
    if (matches(msg, keys.pgdown)) { this.scroll += 10; return [this, null]; }
    if (matches(msg, keys.export)) return this.startExport();

    if (this.focus === 'files') {
      if (matches(msg, keys.up)) { this.cursor = Math.max(0, this.cursor - 1); this.resetFile(); }
      else if (matches(msg, keys.down)) { this.cursor = Math.min(this.visible.length - 1, this.cursor + 1); this.resetFile(); }
      else if (matches(msg, keys.left)) this.change('theme', -1);
      else if (matches(msg, keys.right)) this.change('theme', 1);
    } else {
      const row = OPTION_ROWS[this.opt]!;
      if (matches(msg, keys.up)) this.opt = (this.opt + OPTION_ROWS.length - 1) % OPTION_ROWS.length;
      else if (matches(msg, keys.down)) this.opt = (this.opt + 1) % OPTION_ROWS.length;
      else if (matches(msg, keys.left)) this.change(row.key, -1);
      else if (matches(msg, keys.right) || matches(msg, keys.toggle)) this.change(row.key, 1);
    }
    return [this, null];
  }

  private change(key: OptKey, d: number): void {
    const o = this.o;
    const n = this.file?.lines.length ?? 1;
    switch (key) {
      case 'theme': o.theme = (o.theme + d + THEMES.length) % THEMES.length; break;
      case 'window': o.window = !o.window; break;
      case 'lineNumbers': o.lineNumbers = !o.lineNumbers; break;
      case 'shadow': o.shadow = !o.shadow; break;
      case 'radius': o.radius = clamp(o.radius + d * 2, 0, 24); break;
      case 'padding': o.padding = (o.padding + d + PADDINGS.length) % PADDINGS.length; break;
      case 'start': o.start = clamp(o.start + d, 1, o.end || n); this.scroll = o.start - 1; break;
      case 'end': o.end = o.end === 0 && d < 0 ? n : clamp(o.end + d, o.start, n) === n && d > 0 ? 0 : clamp(o.end + d, o.start, n); break;
      case 'fontSize': o.fontSize = clamp(o.fontSize + d * 2, 8, 32); break;
      case 'format': o.format = FORMATS[(FORMATS.indexOf(o.format) + d + FORMATS.length) % FORMATS.length]!; break;
    }
  }

  /** The library options for the current file and settings. */
  private freezeOptions() {
    const o = this.o;
    const f = this.file!;
    return {
      file: f.path,
      config: 'full',
      theme: THEMES[o.theme],
      window: o.window,
      showLineNumbers: o.lineNumbers,
      shadow: o.shadow ? { blur: 24, x: 0, y: 12 } : { blur: 0, x: 0, y: 0 },
      border: { radius: o.radius },
      padding: PADDINGS[o.padding]!,
      lines: o.start > 1 || o.end > 0 ? [o.start, o.end || f.lines.length] : [],
      font: { size: o.fontSize },
      format: o.format,
    } as const;
  }

  /** Render (cached per settings) to report the image size live. */
  private measure(): { r: Rendered | null; err?: string } {
    if (!this.file) return { r: null };
    const key = JSON.stringify([this.file.path, this.o]);
    if (this.measured.key !== key) {
      try {
        this.measured = { key, r: render({ ...this.freezeOptions(), lines: [...this.freezeOptions().lines] }) };
      } catch (err) {
        this.measured = { key, r: null, err: (err as Error).message };
      }
    }
    return this.measured;
  }

  private startExport(): [Studio, Cmd] {
    if (!this.file || this.exporting) return [this, null];
    this.exporting = true;
    this.status = `exporting ${basename(this.file.path)} as ${this.o.format.toUpperCase()}…`;
    this.statusColor = C.amber;
    const opts = { ...this.freezeOptions(), lines: [...this.freezeOptions().lines] };
    const name = basename(this.file.path, extname(this.file.path));
    const exportCmd: Cmd = async () => {
      await new Promise((r) => setTimeout(r, 60)); // let the spinner draw first
      const t0 = performance.now();
      try {
        const r = render(opts);
        const bytes = encode(r, opts.format);
        mkdirSync(OUT_DIR, { recursive: true });
        const path = join(OUT_DIR, `${name}-${opts.theme}.${opts.format}`);
        writeFileSync(path, bytes);
        const scale = r.scale;
        return {
          _tag: 'exported', path, bytes: bytes.length, ms: Math.round(performance.now() - t0),
          size: `${Math.round(r.width)}×${Math.round(r.height)} px${scale > 1 ? ` (${scale}x)` : ''}`,
        } satisfies ExportedMsg;
      } catch (err) {
        return { _tag: 'exported', error: (err as Error).message } satisfies ExportedMsg;
      }
    };
    return [this, Batch(() => this.spinner.tick(), exportCmd)];
  }

  // ── view ───────────────────────────────────────────────────────────────
  view(): View {
    const v = new View(this.width && this.height ? this.screen() : '');
    v.altScreen = true;
    v.mouseMode = MouseMode.CellMotion;
    v.windowTitle = 'freeze studio';
    return v;
  }

  private screen(): string {
    if (this.width < 90 || this.height < 20) {
      return S(`freeze studio needs at least 90×20 (this is ${this.width}×${this.height})`, { fg: C.amber });
    }
    const leftW = 30;
    const rightW = 34;
    const midW = this.width - leftW - rightW - 2;
    const bodyH = this.height - 4;
    const header = this.header();
    const left = this.fileList(leftW, bodyH);
    const mid = this.preview(midW, bodyH);
    const right = this.optionsPanel(rightW, bodyH);
    const body = joinHorizontal(Top, left, ' ', mid, ' ', right);
    return [header, body, this.statusLine(), this.footer()].join('\n');
  }

  private header(): string {
    const title = S(' freeze ', { fg: C.ink, bg: C.pink, b: true }) + S(' studio ', { fg: C.text, bg: C.violet, b: true });
    const where = S(`  ${ROOT}  →  ${OUT_DIR}/`, { fg: C.dim });
    return pad(title + where, this.width);
  }

  private fileList(w: number, h: number): string {
    const focused = this.focus === 'files';
    const rows: string[] = [];
    rows.push(this.filtering || this.filterInput.value()
      ? ' ' + this.filterInput.view()
      : S(` FILES`, { fg: focused ? C.pink : C.dim, b: true }) + S(`  ${this.visible.length}`, { fg: C.dim }));
    rows.push('');
    const listH = h - 2;
    if (this.cursor < this.listTop) this.listTop = this.cursor;
    if (this.cursor >= this.listTop + listH) this.listTop = this.cursor - listH + 1;
    for (let i = this.listTop; i < Math.min(this.visible.length, this.listTop + listH); i++) {
      const f = this.visible[i]!;
      const sel = i === this.cursor;
      const name = fit(f.rel, w - 12);
      const lang = S(fit(f.language, 9), { fg: sel ? C.amber : C.dim });
      const line = ` ${sel ? '›' : ' '} ${pad(name, w - 13)} ${lang}`;
      rows.push(sel ? S(pad(line, w), { fg: C.text, bg: focused ? C.sel : C.panel, b: true }) : S(line, { fg: C.text }));
    }
    if (this.visible.length === 0) rows.push(S('  no matching files', { fg: C.dim, i: true }));
    while (rows.length < h) rows.push('');
    return rows.map((r) => pad(fit(r, w), w)).join('\n');
  }

  /** The highlighted code drawn as a little window, in the theme's colours. */
  private preview(w: number, h: number): string {
    const f = this.file;
    if (!f) return Array.from({ length: h }, () => ' '.repeat(w)).join('\n');
    const o = this.o;
    const style = getStyle(THEMES[o.theme]!)!;
    const bgEntry = style.get('Background');
    const bg = bgEntry.background ? colourString(bgEntry.background) : '#171717';
    const fgOf = (type: string) => {
      const e = style.get(type);
      return { fg: e.colour ? colourString(e.colour) : undefined, b: e.bold === 1, i: e.italic === 1, u: e.underline === 1 };
    };
    const lnColour = colourString(style.get('LineNumbers').colour || 0x7f7f80);

    // Highlight the whole file once, then split into lines of styled runs.
    const text = f.lines.join('\n');
    const lang = hljsLanguage(getLexer(f.path)!);
    const lines: string[][] = [[]];
    for (const t of tokenise(text, lang)) {
      const st = fgOf(t.type);
      t.value.split('\n').forEach((part, k) => {
        if (k > 0) lines.push([]);
        if (part) lines[lines.length - 1]!.push(S(part.replaceAll('\t', '    '), { ...st, bg }));
      });
    }

    const first = o.start - 1;
    const last = o.end > 0 ? o.end : f.lines.length;
    const innerW = w - 4;
    const padX = o.padding === 3 ? 1 : 2;
    const codeH = h - 6 - (o.window ? 1 : 0);
    const top = clamp(this.scroll, first, Math.max(first, last - codeH));
    this.scroll = top;
    const out: string[] = [];
    const edge = (s: string) => '  ' + s + (o.shadow ? S('▐', { fg: C.faint }) : ' ') + ' ';

    const label = S(` ${f.rel} · ${f.language} · ${THEMES[o.theme]} `, { fg: C.dim });
    out.push(pad(' ' + label, w));
    const r = o.radius > 0;
    out.push(edge(S((r ? '╭' : '┌') + '─'.repeat(innerW - 2) + (r ? '╮' : '┐'), { fg: '#515151', bg })));
    if (o.window) {
      const dots = S('●', { fg: '#FF5A54', bg }) + S(' ', { bg }) + S('●', { fg: '#E6BF29', bg }) + S(' ', { bg }) + S('●', { fg: '#52C12B', bg });
      out.push(edge(S('│ ', { fg: '#515151', bg }) + dots + S(' '.repeat(innerW - 8), { bg }) + S(' │', { fg: '#515151', bg })));
    }
    for (let i = 0; i < codeH; i++) {
      const n = top + i;
      let row = '';
      if (n < last && n < lines.length) {
        const ln = o.lineNumbers ? S(String(n + 1).padStart(3) + '  ', { fg: lnColour, bg }) : '';
        row = ln + lines[n]!.join('');
      }
      const content = fit(row, innerW - 2 - padX);
      out.push(edge(S('│', { fg: '#515151', bg }) + S(' '.repeat(padX - 1), { bg }) + content +
        S(' '.repeat(Math.max(0, innerW - 2 - padX - stringWidth(content))), { bg }) + S(' │', { fg: '#515151', bg })));
    }
    out.push(edge(S((r ? '╰' : '└') + '─'.repeat(innerW - 2) + (r ? '╯' : '┘'), { fg: '#515151', bg })));
    out.push(o.shadow ? '   ' + S('▀'.repeat(innerW), { fg: C.faint }) : '');
    const shown = Math.min(last, top + codeH) - top;
    out.push(S(`  lines ${top + 1}–${top + shown} of ${f.lines.length}` + (o.start > 1 || o.end > 0 ? `  ·  capturing ${first + 1}–${last}` : ''), { fg: C.dim }));
    while (out.length < h) out.push('');
    return out.slice(0, h).map((l) => pad(fit(l, w), w)).join('\n');
  }

  private optionsPanel(w: number, h: number): string {
    const focused = this.focus === 'options';
    const o = this.o;
    const rows: string[] = [S(' OPTIONS', { fg: focused ? C.pink : C.dim, b: true }), ''];
    const value = (k: OptKey): string => {
      switch (k) {
        case 'theme': return THEMES[o.theme]!;
        case 'window': return o.window ? 'on' : 'off';
        case 'lineNumbers': return o.lineNumbers ? 'on' : 'off';
        case 'shadow': return o.shadow ? 'on' : 'off';
        case 'radius': return String(o.radius);
        case 'padding': return PADDINGS[o.padding]!.join(' ');
        case 'start': return String(o.start);
        case 'end': return o.end === 0 ? 'last' : String(o.end);
        case 'fontSize': return String(o.fontSize);
        case 'format': return o.format.toUpperCase();
      }
    };
    OPTION_ROWS.forEach((row, i) => {
      const sel = focused && i === this.opt;
      const v = value(row.key);
      const on = v === 'on';
      const val = sel ? S('‹ ', { fg: C.pink }) + S(v, { fg: C.text, b: true }) + S(' ›', { fg: C.pink })
        : S(v, { fg: v === 'off' ? C.dim : on ? C.green : C.text });
      const line = ` ${sel ? '▌' : ' '} ${pad(row.label, 13)}${val}`;
      rows.push(sel ? S(pad(line, w), { bg: C.sel }) : line);
      if (sel && row.hint) rows.push(S(`     ${row.hint}`, { fg: C.dim, i: true }));
    });
    rows.push('');
    const m = this.measure();
    rows.push(S(' OUTPUT', { fg: C.dim, b: true }));
    if (m.r) {
      rows.push(`   ${S(`${Math.round(m.r.width)}×${Math.round(m.r.height)}`, { fg: C.text, b: true })} ${S('px', { fg: C.dim })}` +
        (m.r.scale > 1 ? S(`  (${m.r.scale}x)`, { fg: C.dim }) : ''));
      rows.push(S(`   ${m.r.language ?? 'ANSI'} · ${m.r.config.font.family}`, { fg: C.dim }));
    } else if (m.err) rows.push(S('   ' + fit(m.err, w - 4), { fg: C.red }));
    while (rows.length < h) rows.push('');
    return rows.slice(0, h).map((l) => pad(fit(l, w), w)).join('\n');
  }

  private statusLine(): string {
    const spin = this.exporting ? this.spinner.view() + ' ' : '';
    return pad(' ' + spin + S(fit(this.status, this.width - 4), { fg: this.statusColor }), this.width);
  }

  private footer(): string {
    const short = this.filtering
      ? [bind(['enter'], 'enter', 'keep'), bind(['esc'], 'esc', 'clear')]
      : [keys.tab, keys.up, keys.left, keys.toggle, keys.theme, keys.filter, keys.pgup, keys.export, keys.quit];
    return ' ' + this.help.shortHelpView(short);
  }
}

const program = NewProgram(new Studio());
await program.run();
process.exit(0);
