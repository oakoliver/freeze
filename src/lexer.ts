/**
 * lexer.ts — language detection and tokenising.
 *
 * Which language a file is follows chroma exactly: the lexer registry is
 * chroma's own (lexers-data.ts), looked up the way lexers.Get and
 * lexers.Analyse do it. The tokens themselves come from highlight.js, mapped
 * onto chroma token types the same way @oakoliver/glamour does, plus a small
 * pass that types the operators, punctuation, numbers and calls highlight.js
 * leaves as plain text (chroma's lexers emit tokens for those).
 */

import hljs from 'highlight.js';
import type { Token, TokenType } from './chroma.js';
import { LEXERS, type LexerConfig } from './lexers-data.js';

export type { LexerConfig };

// ─── Registry lookup (chroma registry.go) ────────────────────────────────────

const byName = new Map<string, LexerConfig>();
const byAlias = new Map<string, LexerConfig>();
for (const l of LEXERS) {
  byName.set(l.name, l);
  byName.set(l.name.toLowerCase(), l);
  for (const a of l.aliases ?? []) {
    byAlias.set(a, l);
    byAlias.set(a.toLowerCase(), l);
  }
}

const IGNORED_SUFFIXES = ['~', '.bak', '.old', '.orig', '.dpkg-dist', '.dpkg-old', '.ucf-dist', '.ucf-new', '.ucf-old', '.rpmnew', '.rpmorig', '.rpmsave', '.in'];

const globCache = new Map<string, RegExp>();

/** Go's filepath.Match pattern syntax as a RegExp. */
function globRegExp(glob: string): RegExp {
  let re = globCache.get(glob);
  if (re) return re;
  let src = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') src += '[^/]*';
    else if (c === '?') src += '[^/]';
    else if (c === '\\' && i + 1 < glob.length) src += '\\' + glob[++i];
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end < 0) { src += '\\['; continue; }
      let body = glob.slice(i + 1, end);
      if (body.startsWith('^')) body = '^' + body.slice(1).replace(/[\]\\]/g, '\\$&');
      else body = body.replace(/[\]\\^]/g, '\\$&');
      src += `[${body}]`;
      i = end;
    } else src += c.replace(/[.+^${}()|\]\\]/g, '\\$&');
  }
  re = new RegExp(src + '$');
  globCache.set(glob, re);
  return re;
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed || '.';
}

function priority(l: LexerConfig): number {
  return l.priority || 1;
}

/** Stable sort by descending priority (Go's sort.Sort is not stable, but ties keep registry order here). */
function best(matches: LexerConfig[]): LexerConfig | undefined {
  let pick: LexerConfig | undefined;
  for (const m of matches) if (!pick || priority(m) > priority(pick)) pick = m;
  return pick;
}

/** lexers.Match: the lexer whose filename globs match the file's base name. */
export function matchLexer(filename: string): LexerConfig | undefined {
  const base = basename(filename);
  const globMatch = (globs: string[] | undefined) =>
    (globs ?? []).some((g) => globRegExp(g).test(base) || IGNORED_SUFFIXES.some((s) => globRegExp(g + s).test(base)));
  const primary = LEXERS.filter((l) => globMatch(l.filenames));
  if (primary.length > 0) return best(primary);
  return best(LEXERS.filter((l) => globMatch(l.aliasFilenames)));
}

/** lexers.Get: by name, alias, file extension or file name. */
export function getLexer(name: string): LexerConfig | undefined {
  const direct = byName.get(name) ?? byAlias.get(name) ?? byName.get(name.toLowerCase()) ?? byAlias.get(name.toLowerCase());
  if (direct) return direct;
  const candidates = [matchLexer('filename.' + name), matchLexer(name)].filter((l): l is LexerConfig => !!l);
  return best(candidates);
}

/** Analysers chroma implements in Go code rather than as XML regexes. */
const GO_ANALYSERS: Record<string, (text: string) => number> = {
  Go: (t) => (t.includes('fmt.') && t.includes('package ') ? 0.5 : t.includes('package ') ? 0.1 : 0),
  PHP: (t) => (t.includes('<?php') ? 0.5 : 0),
  ERB: (t) => (t.includes('<%=') && t.includes('%>') ? 0.4 : t.includes('<%') ? 0.1 : 0),
  dns: (t) => (/^@\s+IN\s+SOA\s+/m.test(t) ? 1 : 0),
  Zed: (t) => {
    if (t.includes('definition ') && t.includes('relation ') && t.includes('permission ')) return 0.9;
    if (t.includes('definition ') || t.includes('relation ')) return 0.5;
    return t.includes('permission ') ? 0.25 : 0;
  },
  MySQL: (t) => {
    const backtick = (t.match(/`[a-zA-Z_]\w*`/g) ?? []).length;
    const bracket = (t.match(/\[[a-zA-Z_]\w*\]/g) ?? []).length;
    if (backtick + bracket >= 1 && backtick >= 2 * bracket) return 0.5;
    if (backtick > bracket) return 0.2;
    return backtick > 0 ? 0.1 : 0;
  },
};

/** Go regexp syntax to JavaScript: inline (?m)/(?s)/(?i) prefixes become flags. */
function analyserRegExp(pattern: string): RegExp {
  let flags = '';
  const m = /^\(\?([ims]+)\)/.exec(pattern);
  if (m) {
    flags = m[1];
    pattern = pattern.slice(m[0].length);
  }
  return new RegExp(pattern, flags);
}

/** lexers.Analyse: the lexer whose analyser scores the text highest. */
export function analyseLexer(text: string): LexerConfig | undefined {
  let picked: LexerConfig | undefined;
  let highest = 0;
  for (const l of LEXERS) {
    let score: number | undefined;
    if (GO_ANALYSERS[l.name]) score = Math.fround(GO_ANALYSERS[l.name](text));
    else if (l.analyse) {
      let sum = 0;
      score = undefined;
      for (const { pattern, score: s } of l.analyse) {
        if (!analyserRegExp(pattern).test(text)) continue;
        if (l.analyseFirst) { score = Math.min(s, 1); break; }
        sum = Math.fround(sum + s);
      }
      if (score === undefined) score = Math.min(sum, 1);
    }
    if (score !== undefined && score > highest) {
      picked = l;
      highest = score;
    }
  }
  return picked;
}

// ─── highlight.js ────────────────────────────────────────────────────────────

/** chroma lexer names whose highlight.js language has a different name or alias. */
const HLJS_NAMES: Record<string, string> = {
  'C#': 'csharp',
  'C++': 'cpp',
  'Bash Session': 'shell',
  'Batchfile': 'dos',
  'Common Lisp': 'lisp',
  'Docker': 'dockerfile',
  'EmacsLisp': 'lisp',
  'FSharp': 'fsharp',
  'Go HTML Template': 'xml',
  'HTML': 'xml',
  'Objective-C': 'objectivec',
  'ObjectPascal': 'delphi',
  'PostgreSQL SQL dialect': 'pgsql',
  'PL/pgSQL': 'pgsql',
  'Protocol Buffer': 'protobuf',
  'reStructuredText': 'plaintext',
  'react': 'javascript',
  'Standard ML': 'sml',
  'SYSTEMD': 'ini',
  'Transact-SQL': 'sql',
  'MySQL': 'sql',
  'VB.net': 'vbnet',
  'VimL': 'vim',
  'vue': 'xml',
  'Svelte': 'xml',
  'PHTML': 'php',
  'Nginx configuration file': 'nginx',
  'ApacheConf': 'apache',
  'TOML': 'ini',
  'properties': 'properties',
  'Terraform': 'plaintext',
  'Python 2': 'python',
  'Materialize SQL dialect': 'sql',
  'Cassandra CQL': 'sql',
  'verilog': 'verilog',
  'systemverilog': 'verilog',
  'NASM': 'x86asm',
  'TASM': 'x86asm',
  'GAS': 'x86asm',
  'ArmAsm': 'armasm',
  'Diff': 'diff',
  'GLSL': 'glsl',
  'TeX': 'latex',
  'Matlab': 'matlab',
  'Octave': 'matlab',
};

/** The highlight.js language for a chroma lexer, or undefined to render plain text. */
export function hljsLanguage(lexer: LexerConfig): string | undefined {
  const candidates = [HLJS_NAMES[lexer.name], lexer.name.toLowerCase(), ...(lexer.aliases ?? [])];
  for (const c of candidates) {
    if (!c) continue;
    if (c === 'plaintext' || c === 'text') return undefined;
    if (hljs.getLanguage(c)) return c;
  }
  return undefined;
}

const SCOPE_TYPES: Record<string, TokenType> = {
  comment: 'Comment',
  doctag: 'CommentSpecial',
  meta: 'CommentPreproc',
  keyword: 'Keyword',
  built_in: 'NameBuiltin',
  type: 'KeywordType',
  literal: 'KeywordConstant',
  number: 'LiteralNumber',
  operator: 'Operator',
  punctuation: 'Punctuation',
  attr: 'NameAttribute',
  attribute: 'NameAttribute',
  property: 'NameAttribute',
  name: 'NameTag',
  'selector-tag': 'NameTag',
  'selector-class': 'NameClass',
  'selector-id': 'NameNamespace',
  'selector-attr': 'NameAttribute',
  'selector-pseudo': 'NameDecorator',
  string: 'LiteralString',
  regexp: 'LiteralStringRegex',
  symbol: 'LiteralStringSymbol',
  subst: 'LiteralStringInterpol',
  code: 'LiteralStringBacktick',
  link: 'NameAttribute',
  bullet: 'Keyword',
  section: 'GenericSubheading',
  emphasis: 'GenericEmph',
  strong: 'GenericStrong',
  addition: 'GenericInserted',
  deletion: 'GenericDeleted',
  variable: 'NameVariable',
  title: 'Name',
  'template-tag': 'CommentPreproc',
  'template-variable': 'NameVariable',
};

/** Keywords chroma's lexers usually type as KeywordNamespace. */
const NAMESPACE_KEYWORDS = new Set(['import', 'package', 'export', 'from', 'namespace', 'using', 'use', 'require', 'module']);

/** Languages whose plain text gets the operator/punctuation pass. */
const PROSE = new Set(['markdown', 'plaintext', 'text', 'asciidoc', 'latex', 'diff']);

/** Languages where `name(` is a call chroma types as NameFunction. */
const CALLS = new Set(['go', 'javascript', 'typescript', 'c', 'cpp', 'csharp', 'java', 'rust', 'swift', 'kotlin', 'php', 'dart', 'scala', 'zig']);

/** hljs class list to a chroma token type, given the enclosing type. */
function scopeType(classes: string[], parent: TokenType | null, rawParent: string): TokenType | null {
  const [first, ...mods] = classes;
  const scope = first.replace(/^hljs-/, '');
  if (scope === 'title') {
    if (mods.includes('function_') || rawParent === 'hljs-function') return 'NameFunction';
    if (rawParent === 'hljs-class') return 'NameClass';
    if (mods.includes('class_')) return 'NameClass';
    return 'Name';
  }
  if (scope === 'char' && mods.includes('escape_')) return 'LiteralStringEscape';
  if (scope === 'variable') {
    if (mods.includes('language_')) return 'NameBuiltinPseudo';
    if (mods.includes('constant_')) return 'NameConstant';
  }
  if (scope === 'meta' && mods.includes('prompt_')) return 'GenericPrompt';
  if (parent === 'CommentPreproc' || parent === 'CommentPreprocFile') {
    if (scope === 'string') return 'CommentPreprocFile';
    if (scope === 'keyword') return 'CommentPreproc';
  }
  return SCOPE_TYPES[scope] ?? null;
}

const PLAIN = /(\s+)|([A-Za-z_][\w]*)(?=(\s*)\()|([A-Za-z_][\w]*)|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(::|:=|[-+*/%=&|^!<>~?]+)|([()[\]{},;.:])|([^\sA-Za-z_\d()[\]{},;.:\-+*/%=&|^!<>~?]+)/g;

/** Types the plain text highlight.js leaves between its spans. */
function plainTokens(text: string, language: string): Token[] {
  const out: Token[] = [];
  PLAIN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLAIN.exec(text)) !== null) {
    let type: TokenType;
    if (m[1]) type = 'Text';
    else if (m[2]) type = CALLS.has(language) ? 'NameFunction' : 'Name';
    else if (m[4]) type = 'Name';
    else if (m[5]) type = 'LiteralNumber';
    else if (m[6]) type = 'Operator';
    else if (m[7]) type = 'Punctuation';
    else type = 'Text';
    out.push({ type, value: m[0] });
  }
  return out;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', '#x27': "'" };

function decode(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|#x27);/g, (_, e: string) => ENTITIES[e]);
}

/**
 * tokenise: highlight code as chroma tokens. With no language the whole input
 * is one Text token (chroma's fallback lexer does the same).
 */
export function tokenise(code: string, language: string | undefined): Token[] {
  if (!language) return code ? [{ type: 'Text', value: code }] : [];
  const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  const prose = PROSE.has(language);
  const tokens: Token[] = [];
  const stack: Array<TokenType | null> = [null];
  const raw: string[] = [''];
  const re = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) {
      const parent = stack[stack.length - 1];
      const classes = m[1].split(/\s+/);
      stack.push(scopeType(classes, parent, raw[raw.length - 1]) ?? parent);
      raw.push(classes[0]);
    } else if (m[0] === '</span>') {
      if (stack.length > 1) {
        stack.pop();
        raw.pop();
      }
    } else {
      const text = decode(m[2]);
      let type = stack[stack.length - 1];
      if (type === 'Keyword' && NAMESPACE_KEYWORDS.has(text)) type = 'KeywordNamespace';
      if (type) tokens.push({ type, value: text });
      else if (prose) tokens.push({ type: 'Text', value: text });
      else tokens.push(...plainTokens(text, language));
    }
  }
  return coalesce(refine(language, tokens));
}

/**
 * Per-language adjustments where chroma's lexers type things differently from
 * highlight.js's scopes in ways that change colours in most themes.
 */
function refine(language: string, tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    // Backslash escapes inside strings (chroma's lexers type them separately).
    if (t.type === 'LiteralString' && /\\/.test(t.value) && language !== 'yaml') {
      for (const part of t.value.split(/(\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[0-7]{1,3}|.))/)) {
        if (part) out.push({ type: part.startsWith('\\') ? 'LiteralStringEscape' : 'LiteralString', value: part });
      }
      continue;
    }
    if (language === 'haskell' && t.type === 'Punctuation' && t.value === '()') {
      out.push({ type: 'NameBuiltin', value: t.value });
      continue;
    }
    if (language === 'yaml') {
      if (t.type === 'NameAttribute') {
        // "key:" -> NameTag "key" + Punctuation ":"
        const m = /^(.*?)(\s*:)$/.exec(t.value);
        if (m) {
          out.push({ type: 'NameTag', value: m[1] }, { type: 'Punctuation', value: m[2] });
          continue;
        }
        out.push({ type: 'NameTag', value: t.value });
        continue;
      }
      // List bullets are text; template variables inside strings stay strings.
      if (t.type === 'Keyword' && t.value.trim() === '-') {
        out.push({ type: 'Text', value: t.value });
        continue;
      }
      if (t.type === 'NameVariable') {
        out.push({ type: 'LiteralString', value: t.value });
        continue;
      }
      // Plain (unquoted) scalars are text in chroma.
      if (t.type === 'LiteralString' && !/^["']/.test(t.value)) {
        out.push({ type: 'Text', value: t.value });
        continue;
      }
    }
    if (language === 'json' && t.type === 'NameAttribute') {
      out.push({ type: 'NameTag', value: t.value });
      continue;
    }
    if (language === 'haskell') {
      if (t.type === 'Keyword' || t.type === 'KeywordNamespace') {
        out.push({ type: 'KeywordReserved', value: t.value });
        continue;
      }
      // Qualified names (Data.List) stay names.
      const prev = out[out.length - 1];
      const next = tokens[k + 1];
      if (t.type === 'Punctuation' && t.value === '.' && prev?.type === 'Name' && next?.type === 'Name' &&
          /^[A-Z]/.test(prev.value)) {
        prev.value += '.' + next.value;
        k++;
        continue;
      }
      // A definition or signature at the start of a line names a function.
      if (t.type === 'Name' && (k === 0 || /\n$/.test(tokens[k - 1].value)) && /^[a-z_]/.test(t.value)) {
        out.push({ type: 'NameFunction', value: t.value });
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/** chroma.Coalesce: merge adjacent tokens of the same type. */
export function coalesce(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    if (t.value.length === 0) continue;
    const prev = out[out.length - 1];
    if (prev && prev.type === t.type && Buffer.byteLength(prev.value) < 8192) prev.value += t.value;
    else out.push({ ...t });
  }
  return out;
}

/** Names accepted by --language: chroma lexer names and aliases. */
export function languageNames(): string[] {
  return LEXERS.map((l) => l.name);
}
