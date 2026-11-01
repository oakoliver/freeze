// Port of upstream freeze_test.go (TestFreeze, TestFreezeOutput, TestFreezeHelp,
// TestFreezeErrorFileMissing) plus more CLI behaviour.
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasResvg } from '../src/raster';
import { runCLI } from './helpers';

const tmp = mkdtempSync(join(tmpdir(), 'freeze-test-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('TestFreeze: no arguments prints help and exits 0', () => {
  expect(runCLI([]).code).toBe(0);
});

test('TestFreezeOutput', () => {
  const out = join(tmp, 'artichoke-test.svg');
  const r = runCLI(['tests/golden/upstream/input/artichoke.hs', '-o', out]);
  expect(r.code).toBe(0);
  expect(existsSync(out)).toBe(true);
  expect(r.stdout).toContain('WROTE');
});

test('TestFreezeHelp', () => {
  const got = runCLI([]).stdout;
  for (const c of [
    'Generate images of code and terminal output.',
    'freeze main.go [-o code.svg] [--flags]',
    '--theme', 'Theme to use for syntax highlighting',
    '--border.color', 'Border color.',
    '--shadow.blur', 'Shadow Gaussian Blur.',
    '--font.family', 'Font family to use for code.',
  ]) expect(got).toContain(c);
});

test('TestFreezeErrorFileMissing', () => {
  const r = runCLI(['this-file-does-not-exist']);
  expect(r.code).not.toBe(0);
  for (const c of ['ERROR', 'File not found', 'open this-file-does-not-exist: no such file or directory']) {
    expect(r.stdout).toContain(c);
  }
});

test('--version', () => {
  expect(runCLI(['--version']).stdout).toContain('freeze version 1.1.0');
});

test('unknown flag is an Invalid Usage error', () => {
  const r = runCLI(['--bogus']);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain('Invalid Usage');
  expect(r.stdout).toContain('unknown flag --bogus');
});

test('unknown language', () => {
  const r = runCLI(['tests/golden/upstream/input/artichoke.hs', '--language', 'no-such-language', '-o', join(tmp, 'x.svg')]);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain('Language Unknown');
});

test('--lines out of bounds', () => {
  const r = runCLI(['tests/golden/upstream/input/artichoke.hs', '--lines', '100,200', '-o', join(tmp, 'x.svg')]);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain('No input');
});

test('stdin is analysed for a language', () => {
  const out = join(tmp, 'stdin.svg');
  const r = runCLI(['-o', out], { input: 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }\n' });
  expect(r.code).toBe(0);
  expect(readFileSync(out, 'utf8')).toContain('fmt');
});

test('stdin with no recognisable language fails like upstream', () => {
  const r = runCLI(['-o', join(tmp, 'x.svg')], { input: 'just some words\n' });
  expect(r.code).toBe(1);
  expect(r.stdout).toContain('Language Unknown');
});

test('default output is freeze.png', () => {
  if (!hasResvg()) return;
  const r = runCLI([join(process.cwd(), 'tests/golden/upstream/input/tab.go')], { cwd: tmp });
  expect(r.code).toBe(0);
  expect(existsSync(join(tmp, 'freeze.png'))).toBe(true);
});

test.if(hasResvg())('PNG output is rendered at 4x when auto-sized', () => {
  const out = join(tmp, 'tab.png');
  expect(runCLI(['tests/golden/upstream/input/tab.go', '-o', out]).code).toBe(0);
  const png = readFileSync(out);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const svgOut = join(tmp, 'tab.svg');
  runCLI(['tests/golden/upstream/input/tab.go', '-o', svgOut]);
  const svgWidth = Number(/<svg width="([\d.]+)"/.exec(readFileSync(svgOut, 'utf8'))![1]);
  expect(Math.abs(png.readUInt32BE(16) - svgWidth * 4)).toBeLessThanOrEqual(1);
});

test.if(hasResvg())('WebP output is real WebP', () => {
  const out = join(tmp, 'tab.webp');
  expect(runCLI(['tests/golden/upstream/input/tab.go', '-o', out]).code).toBe(0);
  const webp = readFileSync(out);
  expect(webp.subarray(0, 4).toString()).toBe('RIFF');
  expect(webp.subarray(8, 16).toString()).toBe('WEBPVP8L');
});

test('interactive mode with no TTY fails cleanly', () => {
  const r = runCLI(['tests/golden/upstream/input/tab.go', '--interactive', '-o', join(tmp, 'i.svg')], { env: { XDG_CONFIG_HOME: tmp } });
  expect(r.code).toBe(1);
  expect(r.stdout).toContain('interactive mode needs a terminal');
});
