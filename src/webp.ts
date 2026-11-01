/**
 * webp.ts — a small lossless WebP (VP8L) encoder in plain TypeScript.
 *
 * Upstream advertises .webp output but writes SVG text into the file. This
 * port encodes real WebP: the subtract-green transform, a colour cache, LZ77
 * backward references (left, above and hash-chain matches) and length-limited
 * canonical prefix codes, following the WebP Lossless Bitstream
 * Specification (RFC 9649). It favours speed over the last few percent of size.
 */

class BitWriter {
  private buf: Uint8Array;
  private pos = 0;
  private acc = 0;
  private nbits = 0;

  constructor(capacity = 1 << 16) {
    this.buf = new Uint8Array(capacity);
  }

  /** Write `n` bits (n <= 24) of `value`, least significant first. */
  write(value: number, n: number): void {
    if (n === 0) return;
    this.acc |= (value & ((1 << n) - 1)) << this.nbits;
    this.nbits += n;
    while (this.nbits >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.nbits -= 8;
    }
  }

  private byte(b: number): void {
    if (this.pos === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.pos++] = b;
  }

  finish(): Uint8Array {
    if (this.nbits > 0) {
      this.byte(this.acc & 0xff);
      this.acc = 0;
      this.nbits = 0;
    }
    return this.buf.subarray(0, this.pos);
  }
}

// ─── Prefix (Huffman) codes ──────────────────────────────────────────────────

/** Code lengths for `counts`, limited to `maxLength` bits. */
function codeLengths(counts: ArrayLike<number>, maxLength: number): Uint8Array {
  const n = counts.length;
  const lengths = new Uint8Array(n);
  const used: number[] = [];
  for (let i = 0; i < n; i++) if (counts[i] > 0) used.push(i);
  if (used.length === 0) return lengths;
  if (used.length === 1) {
    lengths[used[0]] = 1;
    return lengths;
  }
  let minCount = 1;
  for (;;) {
    // Huffman with a binary heap over (weight, node).
    const weight: number[] = [];
    const parent: number[] = [];
    const heap: number[] = [];
    const push = (node: number) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (weight[heap[p]] <= weight[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && weight[heap[l]] < weight[heap[m]]) m = l;
          if (r < heap.length && weight[heap[r]] < weight[heap[m]]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const s of used) {
      weight.push(Math.max(counts[s], minCount));
      parent.push(-1);
      push(weight.length - 1);
    }
    while (heap.length > 1) {
      const a = pop(), b = pop();
      weight.push(weight[a] + weight[b]);
      parent.push(-1);
      const node = weight.length - 1;
      parent[a] = node;
      parent[b] = node;
      push(node);
    }
    let maxLen = 0;
    used.forEach((s, leaf) => {
      let depth = 0;
      for (let p = parent[leaf]; p !== -1; p = parent[p]) depth++;
      lengths[s] = depth;
      maxLen = Math.max(maxLen, depth);
    });
    if (maxLen <= maxLength) return lengths;
    minCount *= 2; // flatten the distribution and try again
  }
}

/** Canonical codes (deflate order), bit-reversed for LSB-first writing. */
function canonicalCodes(lengths: Uint8Array): Uint32Array {
  const maxLen = lengths.reduce((m, l) => Math.max(m, l), 0);
  const blCount = new Uint32Array(maxLen + 1);
  for (const l of lengths) if (l) blCount[l]++;
  const next = new Uint32Array(maxLen + 2);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    next[bits] = code;
  }
  const codes = new Uint32Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) {
    const l = lengths[s];
    if (!l) continue;
    let c = next[l]++;
    let rev = 0;
    for (let i = 0; i < l; i++) {
      rev = (rev << 1) | (c & 1);
      c >>= 1;
    }
    codes[s] = rev;
  }
  return codes;
}

interface PrefixCode {
  lengths: Uint8Array;
  codes: Uint32Array;
}

const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Write a prefix code's description and return the code to write symbols with. */
function writePrefixCode(w: BitWriter, counts: Uint32Array): PrefixCode {
  const used: number[] = [];
  for (let i = 0; i < counts.length && used.length < 3; i++) if (counts[i] > 0) used.push(i);

  // Simple code: one or two symbols below 256.
  if (used.length <= 2 && used.every((s) => s < 256)) {
    const symbols = used.length === 0 ? [0] : used;
    w.write(1, 1);
    w.write(symbols.length - 1, 1);
    if (symbols[0] <= 1) {
      w.write(0, 1);
      w.write(symbols[0], 1);
    } else {
      w.write(1, 1);
      w.write(symbols[0], 8);
    }
    if (symbols.length === 2) w.write(symbols[1], 8);
    const lengths = new Uint8Array(counts.length);
    const codes = new Uint32Array(counts.length);
    if (symbols.length === 2) {
      lengths[symbols[0]] = 1;
      lengths[symbols[1]] = 1;
      codes[symbols[1]] = 1;
    }
    return { lengths, codes }; // a single symbol takes zero bits
  }

  const lengths = codeLengths(counts, 15);

  // Run-length encode the code lengths with symbols 16 (repeat previous), 17 and 18 (zeros).
  let last = lengths.length;
  while (last > 0 && lengths[last - 1] === 0) last--;
  const tokens: Array<[number, number]> = [];
  let prev = 8;
  for (let i = 0; i < last;) {
    const l = lengths[i];
    let run = 1;
    while (i + run < last && lengths[i + run] === l) run++;
    if (l === 0 && run >= 3) {
      const n = Math.min(run, 138);
      tokens.push(n >= 11 ? [18, n - 11] : [17, n - 3]);
      i += n;
      continue;
    }
    if (l !== 0 && l === prev && run >= 3) {
      const n = Math.min(run, 6);
      tokens.push([16, n - 3]);
      i += n;
      continue;
    }
    tokens.push([l, 0]);
    if (l !== 0) prev = l;
    i++;
  }

  const clCounts = new Uint32Array(19);
  for (const [s] of tokens) clCounts[s]++;
  let clLengths = codeLengths(clCounts, 7);
  const clUsed = clLengths.reduce((n, l) => n + (l ? 1 : 0), 0);
  if (clUsed === 1) {
    // A one-symbol code would take zero bits; give it a (never used) partner.
    const only = clLengths.findIndex((l) => l > 0);
    clLengths = new Uint8Array(19);
    clLengths[only] = 1;
    clLengths[only === 0 ? 1 : 0] = 1;
  }
  const clCodes = canonicalCodes(clLengths);

  let numCodes = 19;
  while (numCodes > 4 && clLengths[CODE_LENGTH_ORDER[numCodes - 1]] === 0) numCodes--;

  w.write(0, 1); // normal code
  w.write(numCodes - 4, 4);
  for (let i = 0; i < numCodes; i++) w.write(clLengths[CODE_LENGTH_ORDER[i]], 3);

  // max_symbol: the decoder reads exactly as many code-length symbols as we wrote.
  if (last < lengths.length) {
    const count = tokens.length;
    let lengthBits = 2;
    while ((1 << lengthBits) < count - 1) lengthBits += 2;
    if (count < 2) lengthBits = 2;
    w.write(1, 1);
    w.write((lengthBits - 2) / 2, 3);
    w.write(count - 2, lengthBits);
  } else {
    w.write(0, 1);
  }

  for (const [s, extra] of tokens) {
    w.write(clCodes[s], clLengths[s]);
    if (s === 16) w.write(extra, 2);
    else if (s === 17) w.write(extra, 3);
    else if (s === 18) w.write(extra, 7);
  }
  return { lengths, codes: canonicalCodes(lengths) };
}

// ─── LZ77 prefix coding of lengths and distances ─────────────────────────────

function prefixEncode(value: number): [code: number, extraBits: number, extra: number] {
  const v = value - 1;
  if (v < 4) return [v, 0, 0];
  const highest = 31 - Math.clz32(v);
  const second = (v >> (highest - 1)) & 1;
  const extraBits = highest - 1;
  return [2 * highest + second, extraBits, v & ((1 << extraBits) - 1)];
}

/** Map a pixel distance to a distance code (only the two most common plane codes). */
function distanceCode(width: number, dist: number): number {
  if (dist === width) return 1; // (0, 1): the pixel above
  if (dist === 1) return 2; // (1, 0): the pixel to the left
  return dist + 120;
}

const CACHE_BITS = 10;
const MAX_LENGTH = 4096;
const MIN_MATCH = 3;
const HASH_BITS = 16;
const CHAIN_DEPTH = 16;
const WINDOW = (1 << 20) - 120;

/**
 * encodeWebP: RGBA (straight alpha, 4 bytes per pixel) to a lossless WebP file.
 */
export function encodeWebP(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw new Error(`WebP dimensions must be 1..16384, got ${width}x${height}`);
  }
  const n = width * height;
  const argb = new Uint32Array(n);
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2], a = rgba[4 * i + 3];
    if (a !== 255) hasAlpha = true;
    // Subtract-green transform.
    argb[i] = ((a << 24) | (((r - g) & 0xff) << 16) | (g << 8) | ((b - g) & 0xff)) >>> 0;
  }

  // Pass 1: choose literals, cache hits and backward references.
  const OP_LITERAL = 0, OP_CACHE = 1, OP_COPY = 2;
  const ops = new Uint8Array(n);
  const opA = new Uint32Array(n); // literal argb, cache index, or copy length
  const opB = new Uint32Array(n); // copy distance code
  let opCount = 0;

  const cache = new Uint32Array(1 << CACHE_BITS);
  const cacheValid = new Uint8Array(1 << CACHE_BITS);
  const cacheIndex = (p: number) => Math.imul(0x1e35a7bd, p) >>> (32 - CACHE_BITS);
  const insert = (p: number) => {
    const k = cacheIndex(p);
    cache[k] = p;
    cacheValid[k] = 1;
  };

  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const chain = new Int32Array(n);
  const hashAt = (i: number) =>
    (Math.imul(argb[i] ^ Math.imul(argb[i + 1], 0x9e3779b1) ^ Math.imul(argb[i + 2], 0x85ebca6b), 0x27d4eb2f) >>> (32 - HASH_BITS));
  const addHash = (i: number) => {
    if (i + 2 >= n) return;
    const h = hashAt(i);
    chain[i] = head[h];
    head[h] = i;
  };
  const matchLength = (i: number, j: number, max: number) => {
    let l = 0;
    while (l < max && argb[i + l] === argb[j + l]) l++;
    return l;
  };

  for (let i = 0; i < n;) {
    const max = Math.min(MAX_LENGTH, n - i);
    let bestLen = 0;
    let bestDist = 0;
    if (max >= MIN_MATCH) {
      // The two cheap candidates first: left and above.
      for (const d of [1, width]) {
        if (d > i) continue;
        const l = matchLength(i, i - d, max);
        if (l > bestLen) { bestLen = l; bestDist = d; }
      }
      if (bestLen < max && i + 2 < n) {
        let cand = head[hashAt(i)];
        for (let depth = 0; cand >= 0 && depth < CHAIN_DEPTH && bestLen < max; depth++, cand = chain[cand]) {
          const d = i - cand;
          if (d > WINDOW) break;
          if (argb[cand + bestLen] !== argb[i + bestLen]) continue;
          const l = matchLength(i, cand, max);
          if (l > bestLen) { bestLen = l; bestDist = d; }
        }
      }
    }

    if (bestLen >= MIN_MATCH) {
      ops[opCount] = OP_COPY;
      opA[opCount] = bestLen;
      opB[opCount] = distanceCode(width, bestDist);
      opCount++;
      for (let k = 0; k < bestLen; k++) {
        insert(argb[i + k]);
        addHash(i + k);
      }
      i += bestLen;
      continue;
    }

    const p = argb[i];
    const k = cacheIndex(p);
    if (cacheValid[k] && cache[k] === p) {
      ops[opCount] = OP_CACHE;
      opA[opCount] = k;
    } else {
      ops[opCount] = OP_LITERAL;
      opA[opCount] = p;
    }
    opCount++;
    insert(p);
    addHash(i);
    i++;
  }

  // Histograms.
  const greenSize = 256 + 24 + (1 << CACHE_BITS);
  const hGreen = new Uint32Array(greenSize);
  const hRed = new Uint32Array(256);
  const hBlue = new Uint32Array(256);
  const hAlpha = new Uint32Array(256);
  const hDist = new Uint32Array(40);
  for (let o = 0; o < opCount; o++) {
    const a = opA[o];
    if (ops[o] === OP_LITERAL) {
      hGreen[(a >>> 8) & 0xff]++;
      hRed[(a >>> 16) & 0xff]++;
      hBlue[a & 0xff]++;
      hAlpha[a >>> 24]++;
    } else if (ops[o] === OP_CACHE) {
      hGreen[256 + 24 + a]++;
    } else {
      hGreen[256 + prefixEncode(a)[0]]++;
      hDist[prefixEncode(opB[o])[0]]++;
    }
  }

  // Pass 2: the bitstream.
  const w = new BitWriter(Math.max(1 << 16, n));
  w.write(0x2f, 8);
  w.write(width - 1, 14);
  w.write(height - 1, 14);
  w.write(hasAlpha ? 1 : 0, 1);
  w.write(0, 3); // version
  w.write(1, 1); // a transform follows
  w.write(2, 2); // SUBTRACT_GREEN
  w.write(0, 1); // no more transforms
  w.write(1, 1); // colour cache
  w.write(CACHE_BITS, 4);
  w.write(0, 1); // no meta prefix codes

  const green = writePrefixCode(w, hGreen);
  const red = writePrefixCode(w, hRed);
  const blue = writePrefixCode(w, hBlue);
  const alpha = writePrefixCode(w, hAlpha);
  const dist = writePrefixCode(w, hDist);

  for (let o = 0; o < opCount; o++) {
    const a = opA[o];
    if (ops[o] === OP_LITERAL) {
      const g = (a >>> 8) & 0xff, r = (a >>> 16) & 0xff, b = a & 0xff, al = a >>> 24;
      w.write(green.codes[g], green.lengths[g]);
      w.write(red.codes[r], red.lengths[r]);
      w.write(blue.codes[b], blue.lengths[b]);
      w.write(alpha.codes[al], alpha.lengths[al]);
    } else if (ops[o] === OP_CACHE) {
      const s = 256 + 24 + a;
      w.write(green.codes[s], green.lengths[s]);
    } else {
      const [lc, lbits, lextra] = prefixEncode(a);
      w.write(green.codes[256 + lc], green.lengths[256 + lc]);
      w.write(lextra, lbits);
      const [dc, dbits, dextra] = prefixEncode(opB[o]);
      w.write(dist.codes[dc], dist.lengths[dc]);
      w.write(dextra, dbits);
    }
  }

  const vp8l = w.finish();
  const chunkSize = vp8l.length;
  const padded = chunkSize + (chunkSize & 1);
  const out = new Uint8Array(20 + padded);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 12 + padded, true);
  out.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8); // WEBPVP8L
  view.setUint32(16, chunkSize, true);
  out.set(vp8l, 20);
  return out;
}
