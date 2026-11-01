/**
 * More cases rendered by the Go binary (tests/golden/extra/generate.sh):
 * terminal output with line numbers, wrapping, line ranges, fixed sizes,
 * font options and SGR sequences must match byte for byte; the code case
 * must match in skeleton.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeFont, runCLI, skeleton } from './helpers';

const DIR = join(import.meta.dir, 'golden/extra');
const OUT = join(import.meta.dir, 'output/extra');
mkdirSync(OUT, { recursive: true });
const CASES = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as Array<{ input: string; flags: string[]; output: string }>;

describe('extra goldens from the Go binary', () => {
  for (const tc of CASES) {
    test(tc.output, () => {
      const file = join(OUT, `${tc.output}.svg`);
      const r = runCLI([...(tc.input ? [tc.input] : []), ...tc.flags, '--output', file]);
      expect(r.code).toBe(0);
      const got = normalizeFont(readFileSync(file, 'utf8'));
      const want = normalizeFont(readFileSync(join(DIR, `${tc.output}.svg`), 'utf8'));
      if (tc.output.startsWith('code-')) expect(skeleton(got)).toBe(skeleton(want));
      else expect(got).toBe(want);
    });
  }
});
