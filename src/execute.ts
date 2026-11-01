/**
 * execute.ts — port of charmbracelet/freeze pty.go: run a command in a
 * pseudo-terminal and capture its output, colours included.
 *
 * Upstream uses a real PTY (x/xpty). This port uses Bun's built-in terminal
 * support under Bun, `script(1)` under Node.js on macOS and Linux, and plain
 * pipes with FORCE_COLOR/CLICOLOR_FORCE set everywhere else.
 */

import { spawn, spawnSync } from 'node:child_process';

export interface ExecuteOptions {
  /** Kill the command after this many milliseconds (default 10 000). */
  timeout?: number;
  /** Terminal width the command sees (default: this terminal's, else 80). */
  cols?: number;
  /** Terminal height the command sees (default: this terminal's, else 24). */
  rows?: number;
  /** Working directory. */
  cwd?: string;
  /** Extra environment variables. */
  env?: Record<string, string>;
}

export class ExecuteError extends Error {
  constructor(message: string, public output: string) {
    super(message);
    this.name = 'ExecuteError';
  }
}

/** go-shellwords Parse (without environment or backtick expansion). */
export function parseShellWords(line: string): string[] {
  const args: string[] = [];
  let buf = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const ch of line) {
    if (escaped) {
      buf += ch;
      escaped = false;
      inWord = true;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      if (quote === '"') {
        escaped = true;
        continue;
      }
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) args.push(buf);
      buf = '';
      inWord = false;
      continue;
    }
    buf += ch;
    inWord = true;
  }
  if (quote) throw new Error('invalid command line string');
  if (inWord) args.push(buf);
  return args;
}

function terminalSize(opts: ExecuteOptions): [number, number] {
  const cols = opts.cols ?? (process.stdout.isTTY ? process.stdout.columns : 0) ?? 0;
  const rows = opts.rows ?? (process.stdout.isTTY ? process.stdout.rows : 0) ?? 0;
  return [cols || 80, rows || 24];
}

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

let scriptFlavour: 'bsd' | 'util-linux' | null | undefined;
function detectScript(): 'bsd' | 'util-linux' | null {
  if (scriptFlavour !== undefined) return scriptFlavour;
  scriptFlavour = null;
  if (process.platform === 'win32') return scriptFlavour;
  const probe = spawnSync('script', ['--version'], { encoding: 'utf8' });
  if (probe.error) return scriptFlavour;
  scriptFlavour = /util-linux/.test(probe.stdout + probe.stderr) ? 'util-linux' : 'bsd';
  return scriptFlavour;
}

/**
 * executeCommand: run `command` (split like a shell would, but without a
 * shell) in a terminal and return everything it printed.
 */
export async function executeCommand(command: string, opts: ExecuteOptions = {}): Promise<string> {
  let args: string[];
  try {
    args = parseShellWords(command);
  } catch (err) {
    throw new ExecuteError(`could not execute: ${(err as Error).message}`, '');
  }
  if (args.length === 0) throw new ExecuteError('could not execute: no command', '');
  const timeout = opts.timeout ?? 10_000;
  const [cols, rows] = terminalSize(opts);
  const env = { ...process.env, TERM: process.env.TERM || 'xterm-256color', COLUMNS: String(cols), LINES: String(rows), ...opts.env };

  const bun = (globalThis as any).Bun;
  if (bun && typeof bun.Terminal === 'function') return runBun(bun, args, { timeout, cols, rows, env, cwd: opts.cwd });

  const flavour = detectScript();
  const sizeCmd = `stty cols ${cols} rows ${rows} 2>/dev/null; exec "$0" "$@"`;
  let argv: string[];
  if (flavour === 'bsd') argv = ['script', '-q', '/dev/null', 'sh', '-c', sizeCmd, ...args];
  else if (flavour === 'util-linux') {
    argv = ['script', '-q', '-e', '-c', `sh -c ${shellQuote(sizeCmd)} ${args.map(shellQuote).join(' ')}`, '/dev/null'];
  } else {
    argv = args;
    Object.assign(env, { FORCE_COLOR: '1', CLICOLOR_FORCE: '1' });
  }
  return runPiped(argv, { timeout, env, cwd: opts.cwd, viaScript: flavour !== null });
}

async function runBun(
  bun: any,
  args: string[],
  o: { timeout: number; cols: number; rows: number; env: NodeJS.ProcessEnv; cwd?: string },
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let proc: any;
  try {
    proc = bun.spawn(args, {
      cwd: o.cwd,
      env: o.env,
      terminal: { cols: o.cols, rows: o.rows, data: (_t: unknown, d: Uint8Array) => { chunks.push(d.slice()); } },
    });
  } catch (err) {
    throw new ExecuteError(`could not execute: ${goExecError(err, args[0])}`, '');
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, o.timeout);
  const code: number = await proc.exited;
  clearTimeout(timer);
  // Drain what the terminal still holds (upstream waits up to 200ms).
  await new Promise((r) => setTimeout(r, 50));
  try { proc.terminal?.close?.(); } catch { /* already closed */ }
  const out = Buffer.concat(chunks).toString('utf8');
  if (timedOut) throw new ExecuteError('could not execute: context deadline exceeded', out);
  if (code !== 0) throw new ExecuteError(`could not execute: exit status ${code}`, out);
  return out;
}

function runPiped(
  argv: string[],
  o: { timeout: number; env: NodeJS.ProcessEnv; cwd?: string; viaScript: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => chunks.push(d));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, o.timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ExecuteError(`could not execute: ${goExecError(err, argv[0])}`, ''));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let out = Buffer.concat(chunks).toString('utf8');
      // BSD script echoes ^D and two backspaces when its stdin reaches EOF.
      if (o.viaScript) out = out.replace(/^\^D\x08\x08/, '');
      if (timedOut) reject(new ExecuteError('could not execute: context deadline exceeded', out));
      else if (code !== 0) reject(new ExecuteError(`could not execute: exit status ${code}`, out));
      else resolve(out);
    });
  });
}

function goExecError(err: unknown, file: string): string {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'ENOENT') return `exec: "${file}": executable file not found in $PATH`;
  return e?.message ?? String(err);
}
