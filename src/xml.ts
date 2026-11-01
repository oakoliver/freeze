/**
 * xml.ts — the small part of github.com/beevik/etree that freeze uses.
 *
 * Upstream formats code with chroma's SVG formatter, parses the result with
 * etree, edits the tree and writes it back out. This port builds the same tree
 * directly and serializes it the way etree does (attribute order, self-closing
 * empty elements, etree's escaping rules), so the SVG text matches upstream's.
 */

export type XmlNode = XmlElement | XmlText;

/** XmlText is etree's CharData. */
export class XmlText {
  readonly kind = 'text' as const;
  parent: XmlElement | null = null;
  constructor(public data: string) {}

  copy(): XmlText {
    return new XmlText(this.data);
  }
}

/** XmlElement is etree's Element: ordered attributes and child tokens. */
export class XmlElement {
  readonly kind = 'element' as const;
  attrs: Array<[string, string]> = [];
  children: XmlNode[] = [];
  parent: XmlElement | null = null;

  constructor(public tag: string) {}

  /** CreateAttr: replaces the value in place if the key exists, else appends. */
  setAttr(key: string, value: string): this {
    const existing = this.attrs.find((a) => a[0] === key);
    if (existing) existing[1] = value;
    else this.attrs.push([key, value]);
    return this;
  }

  getAttr(key: string, fallback = ''): string {
    const existing = this.attrs.find((a) => a[0] === key);
    return existing ? existing[1] : fallback;
  }

  hasAttr(key: string): boolean {
    return this.attrs.some((a) => a[0] === key);
  }

  addChild(node: XmlNode): this {
    if (node.parent) node.parent.removeChild(node);
    node.parent = this;
    this.children.push(node);
    return this;
  }

  /** InsertChildAt: inserts before index, or appends when index >= length. */
  insertChildAt(index: number, node: XmlNode): this {
    if (index >= this.children.length) return this.addChild(node);
    if (node.parent) {
      if (node.parent === this && this.children.indexOf(node) < index) index--;
      node.parent.removeChild(node);
    }
    node.parent = this;
    this.children.splice(index, 0, node);
    return this;
  }

  removeChild(node: XmlNode): XmlNode | null {
    const i = this.children.indexOf(node);
    if (i < 0) return null;
    this.children.splice(i, 1);
    node.parent = null;
    return node;
  }

  childElements(): XmlElement[] {
    return this.children.filter((c): c is XmlElement => c.kind === 'element');
  }

  selectElement(tag: string): XmlElement | null {
    return this.childElements().find((c) => c.tag === tag) ?? null;
  }

  selectElements(tag: string): XmlElement[] {
    return this.childElements().filter((c) => c.tag === tag);
  }

  /** Text: the character data immediately after the opening tag. */
  text(): string {
    let out = '';
    for (const c of this.children) {
      if (c.kind !== 'text') break;
      out += c.data;
    }
    return out;
  }

  /** SetText: replaces the leading character data (removes it for ""). */
  setText(text: string): this {
    let end = 0;
    while (end < this.children.length && this.children[end].kind === 'text') end++;
    if (end === 0) {
      if (text !== '') this.insertChildAt(0, new XmlText(text));
      return this;
    }
    const removed = this.children.splice(text === '' ? 0 : 1, text === '' ? end : end - 1);
    for (const r of removed) r.parent = null;
    if (text !== '') (this.children[0] as XmlText).data = text;
    return this;
  }

  /** Copy: a deep copy with no parent. */
  copy(): XmlElement {
    const e = new XmlElement(this.tag);
    e.attrs = this.attrs.map(([k, v]) => [k, v]);
    for (const c of this.children) e.addChild(c.copy());
    return e;
  }
}

/** XmlDocument is an etree Document: a prologue plus the root element. */
export class XmlDocument {
  /** Raw tokens written before and after the root (ProcInst, Directive, CharData). */
  constructor(public before: string, public root: XmlElement, public after: string) {}

  toString(): string {
    return this.before + writeElement(this.root) + this.after;
  }
}

function isInCharacterRange(cp: number): boolean {
  return cp === 0x09 || cp === 0x0a || cp === 0x0d ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff);
}

/** etree's escapeString in escapeNormal mode (used for text and attributes). */
export function escapeXml(s: string): string {
  let out = '';
  for (const ch of s) {
    switch (ch) {
      case '&': out += '&amp;'; break;
      case '<': out += '&lt;'; break;
      case '>': out += '&gt;'; break;
      case "'": out += '&apos;'; break;
      case '"': out += '&quot;'; break;
      default: {
        const cp = ch.codePointAt(0)!;
        // Lone surrogates come through as one UTF-16 unit; Go would have
        // decoded invalid UTF-8 to U+FFFD, so do the same.
        out += isInCharacterRange(cp) && !(cp >= 0xd800 && cp <= 0xdfff) ? ch : '\uFFFD';
      }
    }
  }
  return out;
}

function writeNode(n: XmlNode): string {
  return n.kind === 'text' ? escapeXml(n.data) : writeElement(n);
}

/** Element.WriteTo with default WriteSettings. */
export function writeElement(e: XmlElement): string {
  let out = '<' + e.tag;
  for (const [k, v] of e.attrs) out += ` ${k}="${escapeXml(v)}"`;
  if (e.children.length === 0) return out + '/>';
  out += '>';
  for (const c of e.children) out += writeNode(c);
  return out + `</${e.tag}>`;
}
