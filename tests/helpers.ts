import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..');
export const UPSTREAM = join(ROOT, 'tests/golden/upstream');
export const CLI = join(ROOT, 'src/cli.ts');

/** Run the CLI like upstream's tests run the binary: stdin closed, stdout captured. */
export function runCLI(args: string[], opts: { input?: string; cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd ?? ROOT,
    input: opts.input,
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', ...opts.env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Replace the embedded font's src declaration (upstream mislabels TTF as WOFF2). */
export function normalizeFont(svg: string): string {
  return svg.replace(/src: url\(data:[^;]+;(?:charset=utf-8;)?base64,[^)]*\) format\([^)]*\);(&apos;)?/, 'src: FONT;');
}

/** The SVG with every <text> element's content reduced to its plain text. */
export function skeleton(svg: string): string {
  return svg.replace(/(<text [^>]*>)([\s\S]*?)(<\/text>)/g, (_m, open, body, close) =>
    open + body.replace(/<[^>]+>/g, '') + close);
}

/** The base64 font payload embedded in an SVG. */
export function fontPayload(svg: string): string | undefined {
  return /base64,([A-Za-z0-9+/=]+)\)/.exec(svg)?.[1];
}

/** All tspans as [fill, text] pairs, for measuring colour agreement. */
export function colouredRuns(svg: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of svg.matchAll(/<text [^>]*>([\s\S]*?)<\/text>/g)) {
    let fill = '';
    for (const part of m[1].split(/(<tspan[^>]*>|<\/tspan>)/)) {
      if (part.startsWith('<tspan')) fill = /fill="([^"]+)"/.exec(part)?.[1] ?? '';
      else if (part === '</tspan>') fill = '';
      else for (const ch of part.replace(/&[a-z]+;/g, '_')) out.push([fill, ch]);
    }
  }
  return out;
}
