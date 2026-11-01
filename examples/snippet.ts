/**
 * snippet — a few lines of a file, with line numbers, a theme and a PNG.
 *
 *   bun examples/snippet.ts [file] [start] [end] [theme] [out.png]
 *
 * `lines` is 1-indexed and inclusive, like `freeze --lines 9,16`. Line
 * numbers keep their real values. PNG needs the optional @resvg/resvg-js.
 */
import { writeFileSync } from 'node:fs';
import { renderPNG } from '../src/index.ts';

const [file = 'examples/samples/fib.go', start = '8', end = '16', theme = 'dracula', out = 'snippet.png'] =
  process.argv.slice(2);

const png = renderPNG({
  file,
  lines: [Number(start), Number(end)],
  theme,
  config: 'full',
  showLineNumbers: true,
  padding: [20, 40, 20, 20],
});
writeFileSync(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`);
