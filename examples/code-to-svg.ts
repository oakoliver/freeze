/**
 * code-to-svg — the smallest use of the library: a code file to an SVG.
 *
 *   bun examples/code-to-svg.ts [file] [out.svg]
 *
 * The language comes from the file name (chroma's rules), the look from the
 * "full" preset: window controls, rounded border, drop shadow.
 */
import { writeFileSync } from 'node:fs';
import { renderSVG } from '../src/index.ts';

const file = process.argv[2] ?? 'examples/samples/fib.go';
const out = process.argv[3] ?? 'fib.svg';

const svg = renderSVG({ file, config: 'full' });
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(0)} KB, font embedded)`);
