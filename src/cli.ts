/**
 * cli.ts — the `freeze` command: port of charmbracelet/freeze main.go,
 * help.go and error.go.
 */

import { fstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { joinHorizontal, joinVertical, newStyle, print, println, Center, Left, Top } from '@oakoliver/lipgloss';
import { applyArgs, parseArgs, UsageError, type ParsedArgs } from './args.js';
import {
  applyJSON, DEFAULT_OUTPUT_FILENAME, FLAGS, InvalidJSONError, loadPreset, saveUserConfig, zeroConfig,
  type Config, type FlagSpec,
} from './config.js';
import { ExecuteError, executeCommand } from './execute.js';
import { formatFromPath, FreezeError, goErrorMessage, renderDocument, type RenderSource } from './freeze.js';
import { RasterError, svgToPNG, svgToWebP } from './raster.js';
import { VERSION } from './version.js';

// ─── Output helpers (error.go, main.go) ──────────────────────────────────────

const errorHeader = newStyle()
  .foreground('#F1F1F1')
  .background('#FF5F87')
  .bold(true)
  .padding(0, 1)
  .margin(1)
  .marginLeft(2)
  .setString('ERROR');
const errorDetails = newStyle().foreground('#757575').marginLeft(2);

export function printError(title: string, message: string): void {
  println(joinHorizontal(Center, errorHeader.toString(), title));
  println(errorDetails.render(message));
}

class Exit extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

function fatal(title: string, message: string): never {
  printError(title, message);
  throw new Exit(1);
}

const outputHeader = newStyle()
  .foreground('#F1F1F1')
  .background('#6C50FF')
  .bold(true)
  .padding(0, 1)
  .marginRight(1)
  .setString('WROTE');

function printFilenameOutput(filename: string): void {
  println(joinHorizontal(Center, outputHeader.toString(), filename));
}

// ─── Help (help.go) ──────────────────────────────────────────────────────────

const SPACE = 18;
const HELP_FOREGROUND = '243';

function printFlag(f: FlagSpec): void {
  const dash = newStyle().foreground('240').marginLeft(1);
  const help = newStyle().foreground(HELP_FOREGROUND);
  const keyword = newStyle().foreground('1');
  let line = '    ';
  if (f.short) line += dash.render('-') + f.short;
  else line += dash.render(' ') + ' ';
  line += dash.render('--') + f.name + ' '.repeat(Math.max(0, SPACE - f.name.length));
  const text = f.help.replace(/{{(.+?)}}/g, (_m, word: string) => keyword.render(word) + `\x1b[38;5;${HELP_FOREGROUND}m`);
  println(line + help.render(text));
}

export function printHelp(): void {
  const codeBlock = newStyle().background('235').marginLeft(2).padding(1, 2);
  const bg = codeBlock.getBackground();
  const program = newStyle().background(bg).foreground('#7E65FF').paddingLeft(1);
  const string = newStyle().background(bg).foreground('#02BF87').paddingLeft(1);
  const argument = newStyle().background(bg).foreground('248').paddingLeft(1);
  const flag = newStyle().background(bg).foreground('244').paddingLeft(1);
  const title = newStyle().bold(true).transform((s: string) => s.toUpperCase()).margin(1, 0, 0, 2).foreground('#6C50FF');

  println();
  println('  Generate images of code and terminal output. \u{1F4F8}');
  println(title.render('USAGE'));
  println();
  println(codeBlock.render(joinVertical(
    Top,
    joinHorizontal(Left, program.render('freeze'), argument.render('main.go'), flag.render('[-o code.svg] [--flags]')),
    joinHorizontal(Left, program.render('freeze'), argument.render('--execute'), string.render('"ls -la"'), flag.render('[--flags]   ')),
  )));
  println();
  printFlag(FLAGS.find((f) => f.name === 'interactive')!);
  println(title.render('Settings'));
  for (const f of FLAGS) if (f.group === 'Settings' && !f.hidden) printFlag(f);
  print(title.render('Customization'));
  let lastGroup = '';
  for (const f of FLAGS) {
    if (f.hidden || f.group === 'Settings') continue;
    if (f.group !== lastGroup) {
      lastGroup = f.group;
      println();
    }
    printFlag(f);
  }
  println();
}

// ─── main ────────────────────────────────────────────────────────────────────

function stdinIsPipe(): boolean {
  try {
    return !fstatSync(0).isCharacterDevice();
  } catch {
    return false;
  }
}

/** Build the config the way upstream's two kong passes do: preset, then flags. */
export function buildConfig(args: ParsedArgs): Config {
  const preset = (args.flags.filter((f) => f.spec.name === 'config').pop()?.value as string | undefined) ?? 'default';
  let values: Record<string, unknown>;
  try {
    values = loadPreset(preset);
  } catch (err) {
    if (err instanceof InvalidJSONError) fatal('Invalid JSON', err.message);
    throw err;
  }
  const config = zeroConfig();
  try {
    applyJSON(config, values);
  } catch (err) {
    fatal('Invalid Usage', (err as Error).message);
  }
  applyArgs(config, args);
  return config;
}

/** Run the CLI. Resolves to the process exit code. */
export async function main(argv: string[]): Promise<number> {
  try {
    await run(argv);
    return 0;
  } catch (err) {
    if (err instanceof Exit) return err.code;
    if (err instanceof FreezeError) {
      printError(err.title, err.message);
      return 1;
    }
    printError('Something went wrong', (err as Error)?.message ?? String(err));
    return 1;
  }
}

async function run(argv: string[]): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError || err instanceof Error) fatal('Invalid Usage', err.message);
    throw err;
  }

  if (args.version) {
    println(`freeze version ${VERSION}`);
    return;
  }

  const probe = zeroConfig();
  applyArgs(probe, args);

  let executed: string | undefined;
  if (probe.execute !== '') {
    try {
      executed = await executeCommand(probe.execute, { timeout: probe.executeTimeout });
    } catch (err) {
      const e = err as ExecuteError;
      fatal('Something went wrong', e.output ? `${e.message}\n${e.output}` : e.message);
    }
    if (!executed) fatal('Something went wrong', 'no command output');
  }

  const isDefaultConfig = probe.config === 'default';
  let config = buildConfig(args);

  if (args.help) {
    printHelp();
    return;
  }

  if (config.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) fatal('Something went wrong', 'interactive mode needs a terminal');
    const { runForm } = await import('./interactive.js');
    const result = await runForm(config);
    config = result.config;
    if (result.error) fatal('', result.error.message);
    if (isDefaultConfig) printFilenameOutput(saveUserConfig(config));
  }

  if (config.output === '') config.output = DEFAULT_OUTPUT_FILENAME;

  const pipe = stdinIsPipe();
  if (config.input === '' && !pipe && args.input === undefined && executed === undefined) {
    printHelp();
    return;
  }

  let source: RenderSource;
  if (config.input === '-' || pipe) {
    source = { text: readFileSync(0, 'utf8'), origin: 'stdin' };
  } else if (executed !== undefined) {
    source = { text: executed, origin: 'execute' };
  } else {
    let text: string;
    try {
      text = readFileSync(config.input, 'utf8');
    } catch (err) {
      fatal('File not found', goErrorMessage(err, config.input));
    }
    source = { text, origin: 'file', filename: config.input };
  }

  const format = formatFromPath(config.output);
  const rendered = renderDocument(config, source, format);
  const rasterOptions = {
    loadSystemFonts: config.font.family !== 'JetBrains Mono' || undefined,
    ligatures: config.font.ligatures,
    fontFiles: config.font.file && /\.(ttf|otf)$/i.test(config.font.file) ? [config.font.file] : undefined,
  };

  try {
    if (format === 'png') writeFileSync(config.output, svgToPNG(rendered.svg, rasterOptions));
    else if (format === 'webp') writeFileSync(config.output, svgToWebP(rendered.svg, rasterOptions));
    else writeFileSync(config.output, rendered.svg);
  } catch (err) {
    if (err instanceof RasterError) fatal(`Unable to convert SVG to ${format.toUpperCase()}`, err.message);
    fatal('Unable to write output', goErrorMessage(err, config.output));
  }
  printFilenameOutput(config.output);
}

// Run when executed directly (bin entry or `bun src/cli.ts`).
const entry = process.argv[1] ? basename(process.argv[1]) : '';
if (/^(cli\.(ts|js)|freeze)$/.test(entry)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
