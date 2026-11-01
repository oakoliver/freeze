/**
 * ansi.ts — port of charmbracelet/freeze ansi.go: turn terminal output (SGR
 * colours, backgrounds, italics, underline, strikethrough, tabs) into SVG
 * <tspan>s and background <rect>s.
 *
 * Sequences are tokenised with @oakoliver/lipgloss's ANSI tokenizer; the
 * dispatcher mirrors upstream's handler, quirks included (see README).
 */

import { graphemeWidth } from '@oakoliver/lipgloss';
import type { Config } from './config.js';
import { clamp } from './cut.js';
import { goFixed, goHex2 } from './fmt.js';
import { decodeSequences, type Param } from './sequences.js';
import { XmlElement } from './xml.js';

export const FONT_HEIGHT_TO_WIDTH_RATIO = 1.68;

const TOP = 0;
const LEFT = 3;

/** runewidth.RuneWidth for one code point. */
export function runeWidth(ch: string): number {
  return graphemeWidth(ch);
}

/** The dispatcher upstream registers as the x/ansi parser handler. */
export class Dispatcher {
  row = 0;
  col = 0;
  private bg: XmlElement | null = null;
  private bgWidth = 0;

  constructor(
    private lines: XmlElement[],
    private svg: XmlElement,
    private config: Config,
    private scale: number,
  ) {}

  print(r: string): void {
    this.row = clamp(this.row, 0, this.lines.length - 1);
    const line = this.lines[this.row];
    const children = line.childElements();
    let last: XmlElement;
    if (children.length === 0) {
      last = new XmlElement('tspan').setAttr('xml:space', 'preserve');
      line.addChild(last);
    } else {
      last = children[children.length - 1];
    }

    const w = runeWidth(r);
    if (w > 1) {
      const wide = last.copy();
      wide.setText(r);
      wide.setAttr('dx', `${goFixed((this.config.font.size / 5) * this.scale, 2)}px`);
      line.addChild(wide);
    } else {
      last.setText(last.text() + r);
    }

    this.col += w;
    if (this.bg) this.bgWidth += w;
  }

  execute(code: string): void {
    if (code === '\t') {
      while (this.col % 16 !== 0) this.print(' ');
    }
    if (code === '\n') {
      this.endBackground();
      this.row++;
      this.col = 0;
    }
  }

  private beginBackground(fill: string): void {
    const c = this.config;
    const rect = new XmlElement('rect').setAttr('fill', fill);
    const topOffset = c.padding[TOP] + c.margin[TOP] + ((c.font.size + c.lineHeight) / 5) * this.scale;
    const rowMultiplier = c.font.size * c.lineHeight;
    const y = `${goFixed(this.row * rowMultiplier + topOffset, 2)}px`;
    let x = this.scale * this.col * (c.font.size / FONT_HEIGHT_TO_WIDTH_RATIO);
    x += c.margin[LEFT] + c.padding[LEFT];
    if (c.showLineNumbers) x += c.font.size * 3;
    rect.setAttr('x', `${goFixed(x, 2)}px`);
    rect.setAttr('y', y);
    rect.setAttr('height', `${goFixed(c.font.size * c.lineHeight + 1, 2)}px`);
    this.bg = rect;
  }

  private endBackground(): void {
    if (!this.bg) return;
    let width = (this.bgWidth + 0.5) * this.scale;
    if (this.bgWidth === 0) width = 0;
    this.bg.setAttr('width', `${goFixed(width * (this.config.font.size / FONT_HEIGHT_TO_WIDTH_RATIO), 5)}px`);
    this.svg.insertChildAt(0, this.bg);
    this.bg = null;
    this.bgWidth = 0;
  }

  csiDispatch(cmd: string, params: Param[]): void {
    const line = () => this.lines[this.row];
    const span = new XmlElement('tspan').setAttr('xml:space', 'preserve');
    const reset = () => {
      // An empty tspan resets the style: later text is appended to it.
      if (this.row < this.lines.length) line().addChild(span);
      this.endBackground();
    };
    if (cmd !== 'm') return;
    if (params.length === 0) {
      reset();
      return;
    }

    // Raw parameter value as Go compares it (a ':' sub-parameter never matches).
    const raw = (i: number) => (params[i] ? (params[i].hasMore ? Number.NaN : params[i].value) : undefined);
    const rgb = (i: number) => `#${goHex2(raw(i + 1) ?? 0)}${goHex2(raw(i + 2) ?? 0)}${goHex2(raw(i + 3) ?? 0)}`;

    let i = 0;
    while (i < params.length) {
      const v = Math.max(params[i].value, 0);
      switch (v) {
        case 0:
          reset();
          break;
        case 1:
          line()?.addChild(span);
          break;
        case 9:
          span.setAttr('text-decoration', 'line-through');
          line()?.addChild(span);
          break;
        case 3:
          span.setAttr('font-style', 'italic');
          line()?.addChild(span);
          break;
        case 4:
          span.setAttr('text-decoration', 'underline');
          line()?.addChild(span);
          break;
        case 38:
          i++;
          if (raw(i) === 5) {
            const n = raw(i + 1);
            i++;
            const fill = n !== undefined ? PALETTE[n] : undefined;
            if (fill !== undefined) {
              span.setAttr('fill', fill);
              line()?.addChild(span);
            }
          } else if (raw(i) === 2) {
            span.setAttr('fill', rgb(i));
            line()?.addChild(span);
            i += 3;
          }
          break;
        case 48:
          this.endBackground();
          i++;
          if (raw(i) === 5) {
            const n = raw(i + 1);
            i++;
            const fill = n !== undefined ? PALETTE[n] : undefined;
            if (fill !== undefined) this.beginBackground(fill);
          } else if (raw(i) === 2) {
            this.beginBackground(rgb(i));
            i += 3;
          }
          break;
        default:
          if ((v >= 30 && v <= 37) || (v >= 90 && v <= 97)) {
            span.setAttr('fill', ANSI_PALETTE[v]);
            line()?.addChild(span);
          } else if (v >= 100 && v <= 107) {
            this.beginBackground(ANSI_PALETTE[v] ?? '');
          }
      }
      i++;
    }
  }

  /** Feed one line of terminal output (without its newline) through the parser. */
  parse(text: string): void {
    for (const seq of decodeSequences(text)) {
      if (seq.kind === 'print') {
        for (const ch of seq.seq) this.print(ch);
      } else if (seq.kind === 'control') {
        this.execute(seq.seq);
      } else if (seq.kind === 'csi') {
        this.csiDispatch(seq.marker || seq.intermediate ? '' : seq.cmd, seq.params);
      }
    }
  }
}

/** The 16 colours upstream uses for SGR 30-37 and 90-97 (and 100-107 backgrounds). */
export const ANSI_PALETTE: Record<number, string> = {
  30: '#282a2e', 31: '#D74E6F', 32: '#31BB71', 33: '#D3E561', 34: '#8056FF', 35: '#ED61D7', 36: '#04D7D7', 37: '#C5C8C6',
  90: '#4B4B4B', 91: '#FE5F86', 92: '#00D787', 93: '#EBFF71', 94: '#8F69FF', 95: '#FF7AEA', 96: '#00FEFE', 97: '#FFFFFF',
  // Upstream looks 100-107 up in the same map, which has no entries for them.
};

/** The xterm 256-colour palette upstream uses for 38;5;n and 48;5;n. */
export const PALETTE: string[] = (() => {
  const out = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  const levels = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) {
    out.push(`#${hex(levels[r])}${hex(levels[g])}${hex(levels[b])}`);
  }
  // Upstream's grey ramp (note #606060 and #666666 where xterm has #626262 and #6c6c6c).
  out.push(
    '#080808', '#121212', '#1c1c1c', '#262626', '#303030', '#3a3a3a', '#444444', '#4e4e4e',
    '#585858', '#606060', '#666666', '#767676', '#808080', '#8a8a8a', '#949494', '#9e9e9e',
    '#a8a8a8', '#b2b2b2', '#bcbcbc', '#c6c6c6', '#d0d0d0', '#dadada', '#e4e4e4', '#eeeeee',
  );
  return out;
})();

