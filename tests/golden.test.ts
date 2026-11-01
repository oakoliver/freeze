/**
 * Port of upstream's TestFreezeConfigurations: every case renders through the
 * CLI and is compared with the golden SVG the Go binary produced.
 *
 * Terminal-output (ANSI) cases must match byte for byte. Code cases are lexed
 * by highlight.js instead of chroma, so for those the document skeleton
 * (sizes, positions, window, border, shadow, clip, line numbers and the text
 * of every line) must match byte for byte, and token colours are reported.
 */
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colouredRuns, fontPayload, normalizeFont, runCLI, skeleton, UPSTREAM } from './helpers';

const OUT = join(import.meta.dir, 'output/svg');
mkdirSync(OUT, { recursive: true });

const i = (f: string) => `tests/golden/upstream/input/${f}`;
const c = (f: string) => `tests/golden/upstream/configurations/${f}`;

const ANSI = new Set(['eza', 'layout', 'helix', 'glow', 'execute']);

export const CASES: Array<{ input: string; flags: string[]; output: string }> = [
  { input: i('artichoke.hs'), flags: ['--config', c('base.json')], output: 'artichoke-base' },
  { input: i('artichoke.hs'), flags: ['--config', c('full.json')], output: 'artichoke-full' },
  { input: i('eza.ansi'), flags: ['--config', 'full'], output: 'eza' },
  { input: '', flags: ['--execute', 'echo "Hello, world!"'], output: 'execute' },
  { input: i('bubbletea.model'), flags: ['--language', 'go', '--height', '800', '--width', '750', '--config', 'full', '--window=false', '--show-line-numbers'], output: 'bubbletea' },
  { input: i('layout.ansi'), flags: [], output: 'layout' },
  { input: i('artichoke.hs'), flags: ['--language', 'haskell'], output: 'haskell' },
  { input: i('artichoke.hs'), flags: ['--theme', 'dracula'], output: 'dracula' },
  { input: i('artichoke.hs'), flags: ['--border.radius', '8'], output: 'border-radius' },
  { input: i('artichoke.hs'), flags: ['--border.radius', '8', '--window'], output: 'window' },
  { input: i('artichoke.hs'), flags: ['--border.radius', '8', '--window', '--border.width', '1'], output: 'border-width' },
  { input: i('artichoke.hs'), flags: ['--border.radius', '8', '--window', '--border.width', '1', '--padding', '30,50,30,30'], output: 'padding' },
  { input: i('artichoke.hs'), flags: ['--border.radius', '8', '--window', '--border.width', '1', '--padding', '30,50,30,30', '--margin', '50,60,100,60'], output: 'margin' },
  { input: i('artichoke.hs'), flags: ['--config', 'full'], output: 'shadow' },
  { input: i('artichoke.hs'), flags: ['--width', '1920', '--height', '1080'], output: 'dimensions' },
  { input: i('artichoke.hs'), flags: ['--margin', '50', '--width', '600', '--height', '300'], output: 'dimensions-margin' },
  { input: i('artichoke.hs'), flags: ['--margin', '50', '--width', '600', '--height', '300', '--show-line-numbers'], output: 'dimensions-margin-line-numbers' },
  { input: i('artichoke.hs'), flags: ['--padding', '50', '--width', '600', '--height', '300'], output: 'dimensions-padding' },
  { input: i('artichoke.hs'), flags: ['--config', 'full', '--width', '600', '--height', '300'], output: 'dimensions-config' },
  { input: i('goreleaser-full.yml'), flags: ['--config', 'full', '--width', '600', '--height', '900'], output: 'overflow' },
  { input: i('artichoke.hs'), flags: ['--config', 'full', '--lines', '4,8', '--show-line-numbers'], output: 'lines' },
  { input: i('artichoke.hs'), flags: ['--font.size', '28'], output: 'font-size-28' },
  { input: i('artichoke.hs'), flags: ['--font.size', '14'], output: 'font-size-14' },
  { input: i('artichoke.hs'), flags: ['--line-height', '2'], output: 'line-height-2' },
  { input: i('goreleaser-full.yml'), flags: ['--config', 'full', '--height', '2000', '--show-line-numbers'], output: 'overflow-line-numbers' },
  { input: i('helix.ansi'), flags: ['--background', '#0d1116'], output: 'helix' },
  { input: i('glow.ansi'), flags: [], output: 'glow' },
  { input: i('tab.go'), flags: [], output: 'tab' },
  { input: i('wrap.go'), flags: ['--wrap', '80', '--width', '600'], output: 'wrap' },
];

const FONTS = JSON.parse(readFileSync(join(UPSTREAM, 'fonts.json'), 'utf8')) as Record<string, string[]>;
const agreement: Array<[string, number]> = [];

describe('golden SVGs (upstream TestFreezeConfigurations)', () => {
  for (const tc of CASES) {
    test(tc.output, () => {
      const file = join(OUT, `${tc.output}.svg`);
      const args = [...(tc.input ? [tc.input] : []), ...tc.flags, '--output', file];
      const r = runCLI(args);
      expect(r.code).toBe(0);
      const got = readFileSync(file, 'utf8');
      const want = readFileSync(join(UPSTREAM, 'svg', `${tc.output}.svg`), 'utf8');

      // Same font file as upstream, byte for byte.
      const payload = fontPayload(got);
      expect(payload).toBeDefined();
      const sha = createHash('sha256').update(Buffer.from(payload!, 'base64')).digest('hex');
      const expected = createHash('sha256').update(readFileSync(join(import.meta.dir, '..', 'fonts', FONTS[tc.output][0]))).digest('hex');
      expect(sha).toBe(expected);

      const g = normalizeFont(got);
      const w = normalizeFont(want);
      if (ANSI.has(tc.output)) {
        expect(g).toBe(w);
        return;
      }
      expect(skeleton(g)).toBe(skeleton(w));
      const a = colouredRuns(g);
      const b = colouredRuns(w);
      const same = a.filter(([fill], k) => fill === b[k]?.[0]).length;
      agreement.push([tc.output, same / Math.max(1, b.length)]);
    });
  }

  test('token colour agreement with chroma (reported, not asserted)', () => {
    const avg = agreement.reduce((s, [, v]) => s + v, 0) / Math.max(1, agreement.length);
    if (process.env.FREEZE_REPORT) {
      for (const [name, v] of agreement) console.log(`${name.padEnd(32)} ${(v * 100).toFixed(1)}%`);
      console.log(`average ${(avg * 100).toFixed(1)}%`);
    }
    expect(avg).toBeGreaterThan(0.5);
  });
});
