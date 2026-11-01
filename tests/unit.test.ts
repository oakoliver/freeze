import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colourString, getStyle, parseColour, parseStyleEntry, splitTokensIntoLines, styleNames } from '../src/chroma';
import { parseShellWords } from '../src/execute';
import { goFixed } from '../src/fmt';
import { analyseLexer, getLexer, hljsLanguage, matchLexer, tokenise } from '../src/lexer';
import { encodeWebP } from '../src/webp';
import { wrap } from '../src/wrap';
import { escapeXml, XmlElement, XmlText } from '../src/xml';
import {
  executeCommand, freeze, hasResvg, rasterize, render, renderPNG, renderSVG, renderWebP, resolveConfig,
} from '../src/index';

const tmp = mkdtempSync(join(tmpdir(), 'freeze-unit-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

describe('fmt', () => {
  test('goFixed rounds halfway cases to even like Go', () => {
    expect(goFixed(0.125, 2)).toBe('0.12');
    expect(goFixed(0.375, 2)).toBe('0.38');
    expect(goFixed(2.5, 0)).toBe('2');
    expect(goFixed(651.666666, 2)).toBe('651.67');
    expect(goFixed(-0.001, 2)).toBe('-0.00');
    expect(goFixed(1.005, 2)).toBe('1.00'); // 1.005 is 1.00499999... in binary
    expect(goFixed(99.995, 2)).toBe('100.00'); // 99.99500000000000454... in binary
    expect(goFixed(9.999, 2)).toBe('10.00');
  });
});

describe('xml (etree serialization)', () => {
  test('escaping', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
    expect(escapeXml('a\u0001b')).toBe('a�b');
  });
  test('setText, copy, insert and self-closing', () => {
    const e = new XmlElement('text').setAttr('x', '0');
    e.addChild(new XmlText('a'));
    e.addChild(new XmlText('b'));
    e.addChild(new XmlElement('tspan'));
    expect(e.text()).toBe('ab');
    e.setText('c');
    expect(e.children.length).toBe(2);
    e.setAttr('x', '1').setAttr('y', '2');
    expect(e.attrs).toEqual([['x', '1'], ['y', '2']]);
    const c = e.copy();
    c.setText('');
    expect(e.text()).toBe('c');
    expect(c.children.length).toBe(1);
  });
});

describe('chroma styles', () => {
  test('colours', () => {
    expect(colourString(parseColour('#abc'))).toBe('#aabbcc');
    expect(colourString(parseColour('#ansired'))).toBe('#ff0000');
    expect(parseColour('nope')).toBe(0);
  });
  test('style entries', () => {
    const e = parseStyleEntry('bold #ff0000 bg:#000000');
    expect(e.bold).toBe(1);
    expect(colourString(e.colour)).toBe('#ff0000');
    expect(() => parseStyleEntry('sparkly')).toThrow();
  });
  test('charm inherits and synthesises like chroma', () => {
    const charm = getStyle('charm')!.with({ Background: 'bg:#171717' });
    expect(colourString(charm.get('KeywordReserved').colour)).toBe('#ff48dd');
    expect(colourString(charm.get('KeywordDeclaration').colour)).toBe('#00aaff'); // falls back to Keyword
    expect(colourString(charm.get('LineNumbers').colour)).toBe('#7f7f7f'); // synthesised
    expect(colourString(charm.get('Background').background)).toBe('#171717');
  });
  test('registry', () => {
    const names = styleNames();
    expect(names).toContain('dracula');
    expect(names).toContain('catppuccin-mocha');
    expect(names).toContain('charm');
    expect(getStyle('DRACULA')).toBe(getStyle('dracula'));
    expect(getStyle('nope')).toBeUndefined();
  });
  test('SplitTokensIntoLines', () => {
    expect(splitTokensIntoLines([{ type: 'Text', value: 'a\nb\n' }])).toEqual([
      [{ type: 'Text', value: 'a\n' }],
      [{ type: 'Text', value: 'b\n' }],
    ]);
  });
});

describe('lexers (chroma registry)', () => {
  test('lexers.Get by name, alias, extension and file name', () => {
    expect(getLexer('go')?.name).toBe('Go');
    expect(getLexer('golang')?.name).toBe('Go');
    expect(getLexer('main.go')?.name).toBe('Go');
    expect(getLexer('src/app.tsx')?.name).toBe('TypeScript');
    expect(getLexer('Dockerfile')?.name).toBe('Docker');
    expect(getLexer('Makefile')?.name).toBe('Makefile');
    expect(getLexer('test/input/artichoke.hs')?.name).toBe('Haskell');
    expect(getLexer('x.ansi')).toBeUndefined();
    expect(matchLexer('notes.txt')?.name).toBe('plaintext');
  });
  test('lexers.Analyse', () => {
    expect(analyseLexer('#!/bin/bash\necho hi\n')?.name).toBe('Bash');
    expect(analyseLexer('package main\nimport "fmt"\nfunc main() { fmt.Println() }\n')?.name).toBe('Go');
    expect(analyseLexer('hello world')).toBeUndefined();
  });
  test('highlight.js languages', () => {
    expect(hljsLanguage(getLexer('go')!)).toBe('go');
    expect(hljsLanguage(getLexer('c++')!)).toBe('cpp');
    expect(hljsLanguage(getLexer('plaintext')!)).toBeUndefined();
  });
  test('tokenise maps scopes onto chroma token types', () => {
    const tokens = tokenise('package main\n\nfunc main() {\n\tfmt.Println("hi\\n")\n}\n', 'go');
    const typeOf = (v: string) => tokens.filter((t) => t.value === v).pop()?.type;
    expect(typeOf('package')).toBe('KeywordNamespace');
    expect(typeOf('func')).toBe('Keyword');
    expect(typeOf('main')).toBe('NameFunction');
    expect(typeOf('Println')).toBe('NameFunction');
    expect(typeOf('\\n')).toBe('LiteralStringEscape');
    expect(tokens.map((t) => t.value).join('')).toBe('package main\n\nfunc main() {\n\tfmt.Println("hi\\n")\n}\n');
  });
});

describe('wrap (cellbuf.Wrap)', () => {
  test('word wrap with hard wrap of long words', () => {
    expect(wrap('the quick brown fox', 10)).toBe('the quick\nbrown fox');
    expect(wrap('abcdefghijkl', 5)).toBe('abcde\nfghij\nkl');
    expect(wrap('a-b-c-d', 3)).toBe('a-\nb-c\n-d');
  });
  test('styles are closed and reopened across breaks', () => {
    expect(wrap('\x1b[31mred red red\x1b[m', 4)).toBe('\x1b[31mred\x1b[m\n\x1b[31mred\x1b[m\n\x1b[31mred\x1b[m');
  });
});

describe('shellwords', () => {
  test('quotes and escapes', () => {
    expect(parseShellWords(`echo "Hello, world!"`)).toEqual(['echo', 'Hello, world!']);
    expect(parseShellWords(`ls -la 'a b' c\\ d`)).toEqual(['ls', '-la', 'a b', 'c d']);
    expect(() => parseShellWords(`echo "oops`)).toThrow();
  });
});

describe('webp', () => {
  test('encodes a lossless image that decodes to the same pixels', () => {
    const w = 37, h = 23;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      rgba[i] = (x * 7) & 0xff; rgba[i + 1] = y < 10 ? 30 : (x * y) & 0xff; rgba[i + 2] = 200; rgba[i + 3] = x % 5 ? 255 : 128;
    }
    const webp = encodeWebP(rgba, w, h);
    expect(Buffer.from(webp.subarray(0, 4)).toString()).toBe('RIFF');
    const dwebp = spawnSync('dwebp', ['-version']);
    if (dwebp.error) return; // libwebp tools not installed: header check only
    const file = join(tmp, 'roundtrip.webp');
    writeFileSync(file, webp);
    const out = join(tmp, 'roundtrip.pam');
    expect(spawnSync('dwebp', ['-quiet', file, '-pam', '-o', out]).status).toBe(0);
    const pam = readFileSync(out);
    const data = pam.subarray(pam.indexOf('ENDHDR\n') + 7);
    expect(Buffer.compare(Buffer.from(data), Buffer.from(rgba))).toBe(0);
  });
});

describe('library API', () => {
  test('renderSVG from code', () => {
    const svg = renderSVG({ code: 'const x = 1;\n', language: 'javascript', theme: 'dracula' });
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('fill="#282a36"'); // dracula background
    expect(svg).toContain("format(&apos;truetype&apos;)");
  });
  test('render reports size and language', () => {
    const r = render({ file: 'tests/golden/upstream/input/tab.go', config: 'full', showLineNumbers: true });
    expect(r.language).toBe('Go');
    expect(r.width).toBeGreaterThan(400);
    expect(r.ansi).toBe(false);
    expect(r.svg).toContain('#FF5A54'); // window controls
  });
  test('ANSI input is detected', () => {
    const r = render({ code: '\x1b[31mred\x1b[0m plain\n' });
    expect(r.ansi).toBe(true);
    expect(r.svg).toContain('fill="#D74E6F"');
  });
  test('lines and font options', () => {
    const svg = renderSVG({ file: 'tests/golden/upstream/input/artichoke.hs', lines: [3, 4], font: { family: 'Fira Code' } });
    expect(svg).not.toContain('@font-face');
    expect(svg).toContain('font-family="Fira Code"');
    expect(svg).toContain('Data.Function');
    expect(svg).not.toContain('module');
  });
  test('resolveConfig merges presets and overrides', () => {
    const c = resolveConfig({ config: 'full', border: { radius: 2 } });
    expect(c.window).toBe(true);
    expect(c.border).toEqual({ radius: 2, width: 1, color: '#515151' });
  });
  test.if(hasResvg())('renderPNG and renderWebP', () => {
    const png = renderPNG({ code: 'echo hi\n', language: 'bash' });
    expect(Buffer.from(png.subarray(1, 4)).toString()).toBe('PNG');
    const webp = renderWebP({ code: 'echo hi\n', language: 'bash' });
    expect(Buffer.from(webp.subarray(8, 12)).toString()).toBe('WEBP');
    const px = rasterize(renderSVG({ code: 'x\n', language: 'text' }));
    expect(px.data.length).toBe(px.width * px.height * 4);
  });
  test('freeze writes the output file', () => {
    const out = join(tmp, 'lib.svg');
    const r = freeze({ code: 'print("hi")\n', language: 'python', output: out });
    expect(readFileSync(out, 'utf8')).toBe(r.svg);
  });
  test('executeCommand captures colours through a terminal', async () => {
    const out = await executeCommand(`printf '\\033[32mok\\033[0m\\n'`);
    expect(out).toContain('\x1b[32mok');
  });
});
