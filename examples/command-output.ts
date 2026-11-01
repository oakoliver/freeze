/**
 * command-output — run a command in a terminal and save its coloured output
 * as an image, like `freeze --execute`.
 *
 *   bun examples/command-output.ts ["command"] [out.png]
 *
 * The command runs in a pseudo-terminal (Bun's built-in one, or script(1)
 * under Node.js), so tools that colour their output for terminals do so.
 */
import { writeFileSync } from 'node:fs';
import { encode, freezeCommand } from '../src/index.ts';

const command = process.argv[2] ?? 'git --no-pager log --oneline --graph --decorate --color=always -12';
const out = process.argv[3] ?? 'command.png';

const rendered = await freezeCommand(command, {
  config: 'full',
  format: 'png',
  terminal: { cols: 90, rows: 30 },
});
const png = encode(rendered, 'png');
writeFileSync(out, png);
console.log(`wrote ${out}: ${Math.round(rendered.width)}x${Math.round(rendered.height)} px, ${(png.length / 1024).toFixed(0)} KB`);
