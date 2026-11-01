/**
 * args.ts — command-line parsing with kong's conventions: `--flag value`,
 * `--flag=value`, `-f value`, `-fvalue`, bare boolean flags, `--no-` for
 * negatable flags, comma-separated lists, and one optional positional input.
 */

import { decodeFlag, FLAGS, type Config, type FlagSpec } from './config.js';

export interface ParsedArgs {
  /** Flags given on the command line, in order, already decoded. */
  flags: Array<{ spec: FlagSpec; value: unknown }>;
  input?: string;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const byName = new Map(FLAGS.map((f) => [f.name, f]));
const byShort = new Map(FLAGS.filter((f) => f.short).map((f) => [f.short!, f]));

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { flags: [], help: false, version: false };
  const positionals: string[] = [];
  const lists = new Map<string, number[]>();

  const push = (spec: FlagSpec, raw: unknown) => {
    let value = decodeFlag(spec, raw);
    if (spec.kind === 'list' || spec.kind === 'intlist') {
      // Repeating a list flag appends, as kong does.
      const acc = [...(lists.get(spec.name) ?? []), ...(value as number[])];
      lists.set(spec.name, acc);
      value = acc;
    }
    if (spec.name === 'version') out.version = value as boolean;
    out.flags.push({ spec, value });
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help') {
      out.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      let name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      let spec = byName.get(name);
      let negated = false;
      if (!spec && name.startsWith('no-')) {
        const candidate = byName.get(name.slice(3));
        if (candidate?.negatable) {
          spec = candidate;
          negated = true;
          name = name.slice(3);
        }
      }
      if (!spec) throw new UsageError(`unknown flag --${name}`);
      if (spec.kind === 'bool') {
        const v = eq >= 0 ? decodeFlag(spec, arg.slice(eq + 1)) : true;
        push(spec, negated ? !v : v);
        continue;
      }
      if (eq >= 0) push(spec, arg.slice(eq + 1));
      else {
        if (i + 1 >= argv.length) throw new UsageError(`--${name}: expected ${spec.kind === 'string' ? 'string' : 'value'} value but got EOL`);
        push(spec, argv[++i]);
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1 && arg !== '-') {
      // Short flags: -o out.svg, -oout.svg, -o=out.svg, or grouped booleans (-iv).
      let j = 1;
      while (j < arg.length) {
        const ch = arg[j];
        const spec = byShort.get(ch);
        if (!spec) throw new UsageError(`unknown flag -${ch}`);
        if (spec.kind === 'bool') {
          push(spec, true);
          j++;
          continue;
        }
        let rest = arg.slice(j + 1);
        if (rest.startsWith('=')) rest = rest.slice(1);
        if (rest) push(spec, rest);
        else {
          if (i + 1 >= argv.length) throw new UsageError(`--${spec.name}: expected value but got EOL`);
          push(spec, argv[++i]);
        }
        break;
      }
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length > 1) throw new UsageError(`unexpected argument ${positionals[1]}`);
  out.input = positionals[0];
  return out;
}

/** Apply parsed command-line flags over a config (they win over the preset). */
export function applyArgs(config: Config, args: ParsedArgs): void {
  for (const { spec, value } of args.flags) spec.set(config, Array.isArray(value) ? [...value] : value);
  if (args.input !== undefined) config.input = args.input;
}
