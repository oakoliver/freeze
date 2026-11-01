// Port of upstream config_test.go, plus the kong JSON resolver rules.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyJSON, BASE_PRESET, decodeFlag, expandPadding, FLAGS, FULL_PRESET, loadPreset, parseDuration, resolveConfig,
  resolveJSON, zeroConfig,
} from '../src/config';
import { UPSTREAM } from './helpers';

test('bundled presets are the upstream configurations', () => {
  // The two files under configurations/ upstream; TestConfig parses each one.
  const upstream = JSON.parse(readFileSync(join(UPSTREAM, 'configurations/full.json'), 'utf8'));
  expect(Object.keys(BASE_PRESET).sort()).toEqual(Object.keys(FULL_PRESET).sort());
  for (const preset of [BASE_PRESET, FULL_PRESET]) {
    const c = zeroConfig();
    applyJSON(c, preset as Record<string, unknown>);
    expect(c.theme).toBe('charm');
    expect(c.font.family).toBe('JetBrains Mono');
  }
  expect(upstream.window).toBe(true);
});

test('upstream test configurations parse', () => {
  for (const f of readdirSync(join(UPSTREAM, 'configurations'))) {
    const c = zeroConfig();
    applyJSON(c, loadPreset(join(UPSTREAM, 'configurations', f)));
    expect(c.background).toBe('#171717');
  }
});

test('base preset resolves like kong', () => {
  const c = resolveConfig();
  expect(c.padding).toEqual([20, 40, 20, 20]);
  expect(c.margin).toEqual([0]); // "0" is a one-item list
  expect(c.font.ligatures).toBe(true);
  expect(c.lineHeight).toBe(1.2);
  expect(c.executeTimeout).toBe(10_000);
});

test('unknown --config falls back to base', () => {
  expect(loadPreset('no-such-preset')).toEqual(BASE_PRESET);
});

test('JSON resolver: snake_case, camelCase and nested keys', () => {
  expect(resolveJSON({ line_height: 2 }, 'line-height')).toBe(2);
  expect(resolveJSON({ lineHeight: 3 }, 'line-height')).toBe(3);
  expect(resolveJSON({ border: { radius: 4 } }, 'border.radius')).toBe(4);
  expect(resolveJSON({ 'border.radius': 5 }, 'border.radius')).toBe(5);
  expect(resolveJSON({}, 'border.radius')).toBeUndefined();
});

test('flag decoding', () => {
  const spec = (n: string) => FLAGS.find((f) => f.name === n)!;
  expect(decodeFlag(spec('margin'), '50,60')).toEqual([50, 60]);
  expect(decodeFlag(spec('margin'), [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  expect(decodeFlag(spec('window'), 'false')).toBe(false);
  expect(() => decodeFlag(spec('width'), 'wide')).toThrow();
  expect(parseDuration('10s')).toBe(10_000);
  expect(parseDuration('1m30s')).toBe(90_000);
  expect(parseDuration('250ms')).toBe(250);
});

test('expandPadding', () => {
  expect(expandPadding([10], 1)).toEqual([10, 10, 10, 10]);
  expect(expandPadding([10, 20], 2)).toEqual([20, 40, 20, 40]);
  expect(expandPadding([1, 2, 3, 4], 1)).toEqual([1, 2, 3, 4]);
  expect(expandPadding([1, 2, 3], 1)).toEqual([0, 0, 0, 0]);
});
