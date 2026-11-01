/**
 * sequences.ts — a sequence decoder in the spirit of x/ansi's DecodeSequence,
 * built on @oakoliver/lipgloss's ANSI tokenizer and grapheme widths.
 */

import { ansiTokens, graphemes, graphemeWidth } from '@oakoliver/lipgloss';

/** One CSI parameter: value -1 means missing; hasMore means a ':' followed. */
export interface Param {
  value: number;
  hasMore: boolean;
}

export type Sequence =
  | { kind: 'csi'; seq: string; cmd: string; marker: string; intermediate: string; params: Param[] }
  | { kind: 'osc'; seq: string; command: number; data: string }
  | { kind: 'esc'; seq: string }
  | { kind: 'control'; seq: string }
  | { kind: 'print'; seq: string; width: number };

/** Parse the body of a CSI sequence (after ESC [ or 0x9b). */
export function parseCsi(seq: string): Extract<Sequence, { kind: 'csi' }> {
  const body = seq.startsWith('\x1b[') ? seq.slice(2) : seq.slice(1);
  const cmd = body.slice(-1);
  let rest = body.slice(0, -1);
  let marker = '';
  if (/^[<=>?]/.test(rest)) {
    marker = rest[0];
    rest = rest.slice(1);
  }
  const im = /[\x20-\x2f]+$/.exec(rest);
  const intermediate = im ? im[0] : '';
  if (im) rest = rest.slice(0, -intermediate.length);
  const params: Param[] = [];
  if (rest.length > 0) {
    let cur = -1;
    for (const ch of rest) {
      if (ch >= '0' && ch <= '9') cur = (cur < 0 ? 0 : cur * 10) + (ch.charCodeAt(0) - 48);
      else if (ch === ';' || ch === ':') {
        params.push({ value: cur, hasMore: ch === ':' });
        cur = -1;
      }
    }
    params.push({ value: cur, hasMore: false });
  }
  return { kind: 'csi', seq, cmd, marker, intermediate, params: params.slice(0, 32) };
}

function classify(seq: string): Sequence {
  const c = seq.charCodeAt(0);
  if (c === 0x9b || seq.startsWith('\x1b[')) return parseCsi(seq);
  if (c === 0x9d || seq.startsWith('\x1b]')) {
    const body = seq.replace(/^(\x1b\]|\x9d)/, '').replace(/(\x07|\x9c|\x1b\\)$/, '');
    const semi = body.indexOf(';');
    const head = semi < 0 ? body : body.slice(0, semi);
    return { kind: 'osc', seq, command: /^\d+$/.test(head) ? Number(head) : -1, data: body };
  }
  return { kind: 'esc', seq };
}

/**
 * Decode a string into escape sequences, C0/C1 controls and printable
 * characters. Like Go's decoder, ASCII is handled one byte at a time and only
 * a non-ASCII lead starts a grapheme cluster.
 */
export function* decodeSequences(input: string): Generator<Sequence> {
  for (const token of ansiTokens(input)) {
    if (token.ansi) {
      yield classify(token.value);
      continue;
    }
    yield* decodeText(token.value);
  }
}

function* decodeText(text: string): Generator<Sequence> {
  for (const cluster of graphemes(text)) {
    let rest = cluster;
    while (rest.length > 0) {
      const c = rest.charCodeAt(0);
      if (c < 0x80 || (c >= 0x80 && c < 0xa0)) {
        const ch = rest[0];
        rest = rest.slice(1);
        if (c < 0x20 || c === 0x7f || c >= 0x80) yield { kind: 'control', seq: ch };
        else yield { kind: 'print', seq: ch, width: 1 };
        if (rest) {
          yield* decodeText(rest);
          rest = '';
        }
      } else {
        yield { kind: 'print', seq: rest, width: graphemeWidth(rest) };
        rest = '';
      }
    }
  }
}
