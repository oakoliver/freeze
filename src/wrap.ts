/**
 * wrap.ts — port of charmbracelet/x/cellbuf Wrap, which freeze uses for
 * --wrap. Wraps at word boundaries (hard-wrapping words that are too long),
 * keeps SGR styles and OSC 8 links open across the inserted line breaks.
 */

import { decodeSequences, type Param } from './sequences.js';

const NBSP = 0xa0;

/** Go's unicode.IsSpace. */
function isGoSpace(cp: number): boolean {
  if (cp < 0x80) return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d);
  return cp === 0x85 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

/** The pen state cellbuf.ReadStyle tracks, enough to rebuild the SGR sequence. */
interface Pen {
  bold: boolean; faint: boolean; italic: boolean; blink: boolean; rapidBlink: boolean;
  reverse: boolean; conceal: boolean; strike: boolean;
  underline: number; // 0 none, 1 single, 2 double, 3 curly, 4 dotted, 5 dashed
  fg: string | null; bg: string | null; ul: string | null;
}

const emptyPen = (): Pen => ({
  bold: false, faint: false, italic: false, blink: false, rapidBlink: false, reverse: false, conceal: false,
  strike: false, underline: 0, fg: null, bg: null, ul: null,
});

function penEmpty(p: Pen): boolean {
  return !p.bold && !p.faint && !p.italic && !p.blink && !p.rapidBlink && !p.reverse && !p.conceal &&
    !p.strike && p.underline === 0 && p.fg === null && p.bg === null && p.ul === null;
}

/** ReadStyleColor: returns the colour's SGR tail and how many params it used. */
function readColor(params: Param[], i: number): [string | null, number] {
  const v = (k: number) => (params[k] ? Math.max(params[k].value, 0) : 0);
  if (i + 1 >= params.length) return [null, 0];
  const kind = v(i + 1);
  if (kind === 5 && i + 2 < params.length) return [`5;${v(i + 2)}`, 3];
  if (kind === 2 && i + 4 < params.length) return [`2;${v(i + 2)};${v(i + 3)};${v(i + 4)}`, 5];
  return [null, 0];
}

function readStyle(params: Param[], pen: Pen): void {
  if (params.length === 0) {
    Object.assign(pen, emptyPen());
    return;
  }
  for (let i = 0; i < params.length; i++) {
    const p = Math.max(params[i].value, 0);
    switch (p) {
      case 0: Object.assign(pen, emptyPen()); break;
      case 1: pen.bold = true; break;
      case 2: pen.faint = true; break;
      case 3: pen.italic = true; break;
      case 4: {
        const next = params[i + 1];
        if (params[i].hasMore && next && next.value >= 0 && next.value <= 5) {
          i++;
          pen.underline = Math.max(next.value, 0);
        } else pen.underline = 1;
        break;
      }
      case 5: pen.blink = true; break;
      case 6: pen.rapidBlink = true; break;
      case 7: pen.reverse = true; break;
      case 8: pen.conceal = true; break;
      case 9: pen.strike = true; break;
      case 22: pen.bold = false; pen.faint = false; break;
      case 23: pen.italic = false; break;
      case 24: pen.underline = 0; break;
      case 25: pen.blink = false; pen.rapidBlink = false; break;
      case 27: pen.reverse = false; break;
      case 28: pen.conceal = false; break;
      case 29: pen.strike = false; break;
      case 39: pen.fg = null; break;
      case 49: pen.bg = null; break;
      case 59: pen.ul = null; break;
      case 38: case 48: case 58: {
        const [c, n] = readColor(params, i);
        if (n > 0) {
          if (p === 38) pen.fg = `38;${c}`;
          else if (p === 48) pen.bg = `48;${c}`;
          else pen.ul = `58;${c}`;
          i += n - 1;
        }
        break;
      }
      default:
        if (p >= 30 && p <= 37) pen.fg = String(p);
        else if (p >= 40 && p <= 47) pen.bg = String(p);
        else if (p >= 90 && p <= 97) pen.fg = String(p);
        else if (p >= 100 && p <= 107) pen.bg = String(p);
    }
  }
}

/** Style.Sequence(). */
function penSequence(p: Pen): string {
  if (penEmpty(p)) return '\x1b[m';
  const parts: string[] = [];
  if (p.bold) parts.push('1');
  if (p.faint) parts.push('2');
  if (p.italic) parts.push('3');
  if (p.blink) parts.push('5');
  if (p.rapidBlink) parts.push('6');
  if (p.reverse) parts.push('7');
  if (p.conceal) parts.push('8');
  if (p.strike) parts.push('9');
  if (p.underline !== 0) parts.push(p.underline === 1 ? '4' : `4:${p.underline}`);
  if (p.fg) parts.push(p.fg);
  if (p.bg) parts.push(p.bg);
  if (p.ul) parts.push(p.ul);
  return `\x1b[${parts.join(';')}m`;
}

interface Link { url: string; params: string }

/**
 * wrap: cellbuf.Wrap(s, limit, breakpoints). A hyphen is always a breakpoint;
 * `breakpoints` lists extra one-cell characters to break after.
 */
export function wrap(s: string, limit: number, breakpoints = ''): string {
  if (s.length === 0) return '';
  if (limit < 1) return s;

  const breaks = new Set(Array.from(breakpoints, (c) => c.codePointAt(0)!));
  let buf = '';
  let word = '';
  let space = '';
  let style = emptyPen();
  let curStyle = emptyPen();
  let link: Link = { url: '', params: '' };
  let curLink: Link = { url: '', params: '' };
  let curWidth = 0;
  let wordLen = 0;

  const hasBlankStyle = () => !style.reverse && style.bg === null && style.underline === 0;
  const addSpace = () => {
    curWidth += space.length; // bytes in Go; spaces are ASCII here except NBSP-free whitespace
    buf += space;
    space = '';
  };
  const addWord = () => {
    if (word.length === 0) return;
    curLink = { ...link };
    curStyle = { ...style };
    addSpace();
    curWidth += wordLen;
    buf += word;
    word = '';
    wordLen = 0;
  };
  const addNewline = () => {
    if (!penEmpty(curStyle)) buf += '\x1b[m';
    if (curLink.url) buf += '\x1b]8;;\x07';
    buf += '\n';
    if (curLink.url) buf += `\x1b]8;${curLink.params};${curLink.url}\x07`;
    if (!penEmpty(curStyle)) buf += penSequence(curStyle);
    curWidth = 0;
    space = '';
  };

  for (const seq of decodeSequences(s)) {
    if (seq.kind !== 'print') {
      if (seq.seq === '\t') {
        addWord();
        space += seq.seq;
        continue;
      }
      if (seq.seq === '\n') {
        if (wordLen === 0) {
          if (curWidth + space.length > limit) curWidth = 0;
          else buf += space;
          space = '';
        }
        addWord();
        addNewline();
        continue;
      }
      if (seq.kind === 'csi' && seq.cmd === 'm' && !seq.marker && !seq.intermediate) readStyle(seq.params, style);
      else if (seq.kind === 'osc' && seq.command === 8) {
        const parts = seq.data.split(';');
        link = { params: parts[1] ?? '', url: parts.slice(2).join(';') };
      }
      word += seq.seq;
      continue;
    }

    const { seq: text, width } = seq;
    if (text.length === 1 && text.charCodeAt(0) < 0x80) {
      const cp = text.charCodeAt(0);
      if (cp !== NBSP && isGoSpace(cp) && hasBlankStyle()) {
        addWord();
        space += text;
        continue;
      } else if (text === '-' || breaks.has(cp)) {
        addSpace();
        if (curWidth + wordLen + width <= limit) {
          addWord();
          buf += text;
          curWidth += width;
          continue;
        }
      }
    }

    if (wordLen + width > limit) addWord();
    word += text;
    wordLen += width;
    if (curWidth + wordLen + space.length > limit) addNewline();
  }

  if (wordLen === 0) {
    if (curWidth + space.length > limit) curWidth = 0;
    else buf += space;
    space = '';
  }
  addWord();
  if (curLink.url) buf += '\x1b]8;;\x07';
  if (!penEmpty(curStyle)) buf += '\x1b[m';
  return buf;
}
