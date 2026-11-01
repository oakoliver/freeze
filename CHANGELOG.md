# Changelog

## 1.0.0 — port of freeze v0.2.2

First release: a TypeScript port of [charmbracelet/freeze](https://github.com/charmbracelet/freeze)
[v0.2.2](https://github.com/charmbracelet/freeze/releases/tag/v0.2.2) plus `main`
up to [`65acb1e`](https://github.com/charmbracelet/freeze/commit/65acb1e)
(`--execute` drains the terminal for at most 200 ms after the command exits,
and works on Windows).

### Ported

- The `freeze` command with all of upstream's flags, the `base`, `full` and
  `user` presets, JSON configuration files resolved the way kong does, help and
  error output.
- The rendering pipeline: chroma's SVG formatter and etree's serialization, so
  the SVG text matches upstream's; window controls, border, outline, shadow,
  padding, margins, fixed and automatic sizes, clipping, line numbers, `--lines`
  and `--wrap` (a port of `cellbuf.Wrap`).
- Terminal output (`--execute` and ANSI input): SGR colours (16, 256 and true
  colour), backgrounds, italics, underline, strikethrough, tabs and wide
  characters, with upstream's dispatcher quirks.
- chroma's 74 styles plus `charm`, and chroma's lexer registry for language
  detection, generated from chroma v2.24.1.
- PNG through resvg (`@resvg/resvg-js`, optional) with the bundled fonts, and
  `rsvg-convert` as a fallback.
- `--interactive`, built with @oakoliver/huh.
- Upstream's tests and its 29 golden SVGs, plus 8 more goldens from the Go
  binary.

### Different from upstream

- Code is highlighted with highlight.js mapped onto chroma token types, so
  token colours can differ (layout and text do not).
- The embedded font is declared as TrueType (upstream calls it WOFF2).
- `.webp` writes real lossless WebP (upstream writes SVG text into the file).
- PNG prefers resvg over `rsvg-convert`, which ignores the embedded font.
- `--no-font.ligatures` turns ligatures off in PNG and WebP too.
- `--execute` uses Bun's terminal or `script(1)` instead of a native PTY.
- Interactive mode keeps one field per line and needs a terminal.

See the README's parity section for the details.
