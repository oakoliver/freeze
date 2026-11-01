/**
 * tea-snapshot — freeze a Bubble Tea program's view.
 *
 * A small release dashboard (services deploying with spinners, progress bars
 * and a log) built with @oakoliver/bubbletea, @oakoliver/bubbles and
 * @oakoliver/lipgloss. A view is just a string with ANSI styling, so freeze
 * can turn any frame of it into an image.
 *
 * Usage:
 *   bun examples/tea-snapshot.ts               run it; press s to save the screen as SVG, q to quit
 *   bun examples/tea-snapshot.ts --headless    no terminal: step the model and write three frames
 *   bun examples/tea-snapshot.ts --headless --png --out assets
 *
 * In headless mode the model is driven by calling update() with the same
 * messages the program would receive, and view() is rendered with freeze.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NewProgram, View, Quit, Batch, Tick, WindowSizeMsg, KeyPressMsg } from '@oakoliver/bubbletea';
import type { Cmd, Msg } from '@oakoliver/bubbletea';
import { newStyle, width as blockWidth, joinHorizontal, joinVertical, Top, Left, roundedBorder } from '@oakoliver/lipgloss';
import {
  newSpinner, withSpinner, withSpinnerStyle, Line, newProgress, withProgressWidth, withProgressColors, withFillCharacters,
} from '@oakoliver/bubbles';
import { encode, renderDocument, resolveConfig } from '../src/index.ts';

const args = process.argv.slice(2);
const HEADLESS = args.includes('--headless');
const PNG = args.includes('--png');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1]! : 'snapshots';

const C = { violet: '#7D56F4', pink: '#EE6FF8', green: '#04D98B', amber: '#FFB454', red: '#FF5F87', text: '#D6D6E7', dim: '#6C6C88', faint: '#3A3A4E' };
const S = (t: string, fg: string, bold = false) => newStyle().inline(true).foreground(fg).bold(bold).render(t);

interface Service { name: string; region: string; steps: number; step: number; speed: number; failedAt?: number }
const SERVICES: Service[] = [
  { name: 'api-gateway', region: 'eu-west-1', steps: 12, step: 0, speed: 3 },
  { name: 'billing', region: 'eu-west-1', steps: 9, step: 0, speed: 2 },
  { name: 'search', region: 'us-east-2', steps: 15, step: 0, speed: 2, failedAt: 11 },
  { name: 'notifications', region: 'ap-south-1', steps: 8, step: 0, speed: 1 },
  { name: 'web', region: 'us-east-2', steps: 10, step: 0, speed: 2 },
];
const STAGES = ['build', 'test', 'push', 'migrate', 'rollout'];

interface FrameMsg { _tag: 'frame' }
interface SavedMsg { _tag: 'saved'; path: string; bytes: number }
const frame = (): Cmd => Tick(120, () => ({ _tag: 'frame' }) satisfies FrameMsg);

/** freeze the given view (ANSI text) to an image file. */
function snapshot(view: string, path: string): number {
  const format = path.endsWith('.png') ? 'png' : 'svg';
  const config = resolveConfig({ config: 'full', theme: 'charm', background: '#1A1A24', padding: [20, 30, 20, 20] });
  const rendered = renderDocument(config, { text: view, origin: 'execute' }, format);
  const bytes = encode(rendered, format);
  writeFileSync(path, bytes);
  return bytes.length;
}

class Dashboard {
  width = 96;
  height = 26;
  ticks = 0;
  services = SERVICES.map((s) => ({ ...s }));
  spinner = newSpinner(withSpinner(Line), withSpinnerStyle(newStyle().foreground(C.pink)));
  bar = newProgress(withProgressWidth(26), withProgressColors(C.violet, C.pink), withFillCharacters('━', '─'));
  log: string[] = [];
  saved = '';

  init(): Cmd { return Batch(() => this.spinner.tick(), frame()); }

  update(msg: Msg): [Dashboard, Cmd] {
    if (msg instanceof WindowSizeMsg) { this.width = msg.width; this.height = msg.height; return [this, null]; }
    if (msg instanceof KeyPressMsg) {
      const key = msg.toString();
      if (key === 'q' || key === 'ctrl+c') return [this, Quit];
      if (key === 's') {
        const view = this.content();
        const path = join(OUT, `dashboard-${this.ticks}.svg`);
        return [this, () => {
          mkdirSync(OUT, { recursive: true });
          return { _tag: 'saved', path, bytes: snapshot(view, path) } satisfies SavedMsg;
        }];
      }
      return [this, null];
    }
    const tag = (msg as { _tag?: string })?._tag;
    if (tag === 'saved') { const m = msg as SavedMsg; this.saved = `saved ${m.path} (${(m.bytes / 1024).toFixed(0)} KB)`; return [this, null]; }
    if (tag === 'frame') { this.advance(); return [this, this.done() ? null : frame()]; }
    if ((msg as { type?: string })?.type === 'spinner.tick') {
      const [s, c] = this.spinner.update(msg);
      this.spinner = s;
      return [this, c];
    }
    return [this, null];
  }

  advance(): void {
    this.ticks++;
    for (const s of this.services) {
      if (s.step >= s.steps || s.step === s.failedAt) continue;
      if (this.ticks % (4 - Math.min(3, s.speed)) !== 0) continue;
      s.step++;
      const stage = STAGES[Math.min(STAGES.length - 1, Math.floor((s.step / s.steps) * STAGES.length))];
      if (s.step === s.failedAt) this.log.push(S('✗ ', C.red) + S(s.name, C.text, true) + S(` ${stage} failed: health check timed out`, C.red));
      else if (s.step === s.steps) this.log.push(S('✓ ', C.green) + S(s.name, C.text, true) + S(` live in ${s.region}`, C.dim));
      else if (s.step % 4 === 0) this.log.push(S('· ', C.faint) + S(s.name, C.text) + S(` ${stage} (${s.step}/${s.steps})`, C.dim));
    }
    this.log = this.log.slice(-7);
  }

  done(): boolean { return this.services.every((s) => s.step >= s.steps || s.step === s.failedAt); }

  /** The dashboard as a string: this is what gets frozen. */
  content(): string {
    const live = this.services.filter((s) => s.step >= s.steps).length;
    const failed = this.services.filter((s) => s.step === s.failedAt).length;
    const title = S(' release ', '#0B0B14', true);
    const head = newStyle().background(C.pink).render(title) + '  ' + S('v2.14.0', C.text, true) + S('  ·  ', C.faint) +
      S(`${live} live`, C.green) + S('  ·  ', C.faint) + S(`${failed} failed`, failed ? C.red : C.dim) +
      S('  ·  ', C.faint) + S(`${this.services.length - live - failed} rolling out`, C.amber);

    const rows = this.services.map((s) => {
      const pct = s.step / s.steps;
      const icon = s.step === s.failedAt ? S('✗', C.red) : s.step >= s.steps ? S('✓', C.green) : this.spinner.view();
      const stage = s.step === s.failedAt ? S('failed', C.red) : s.step >= s.steps ? S('live', C.green)
        : S(STAGES[Math.min(STAGES.length - 1, Math.floor(pct * STAGES.length))]!, C.amber);
      const name = S(s.name.padEnd(15), C.text, true);
      return `${icon} ${name}${S(s.region.padEnd(12), C.dim)}${this.bar.viewAs(pct)}  ${stage}`;
    });
    const table = newStyle().border(roundedBorder()).borderForeground(C.faint).padding(0, 1)
      .render(joinVertical(Left, S('SERVICES', C.violet, true), '', ...rows));
    const logBox = newStyle().border(roundedBorder()).borderForeground(C.faint).padding(0, 1).width(Math.max(30, blockWidth(table)))
      .render(joinVertical(Left, S('EVENTS', C.violet, true), '', ...(this.log.length ? this.log : [S('waiting for the first stage…', C.dim)])));
    return joinVertical(Left, head, '', joinHorizontal(Top, table), logBox);
  }

  view(): View {
    const help = S(this.saved || 's save the screen as SVG  ·  q quit', this.saved ? C.green : C.dim);
    const v = new View(this.content() + '\n\n' + help);
    v.altScreen = true;
    return v;
  }
}

if (HEADLESS) {
  // Drive the model with the messages a program would send, and freeze three moments.
  const m = new Dashboard();
  mkdirSync(OUT, { recursive: true });
  const ext = PNG ? 'png' : 'svg';
  const moments = [6, 18, 60];
  for (let t = 1; t <= Math.max(...moments); t++) {
    m.update({ _tag: 'frame' } satisfies FrameMsg);
    const [s] = m.spinner.update(m.spinner.tick());
    m.spinner = s;
    if (moments.includes(t)) {
      const path = join(OUT, `tea-dashboard-${t}.${ext}`);
      const t0 = performance.now();
      const bytes = snapshot(m.content(), path);
      console.log(`${path}  ${(bytes / 1024).toFixed(0)} KB  ${Math.round(performance.now() - t0)} ms`);
    }
  }
} else {
  await NewProgram(new Dashboard()).run();
  process.exit(0);
}
