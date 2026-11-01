# Examples

Every image in the README was made by one of these programs or by the CLI.
Run them from the repository root after `bun install`. They import the
package's source directly (`../src/index.ts`); the sibling ports they use
(`@oakoliver/bubbletea`, `@oakoliver/bubbles`, `@oakoliver/lipgloss`) are
dependencies or dev dependencies of this repository, so nothing else needs
installing. PNG and WebP need `@resvg/resvg-js`, which `bun install` adds as an
optional dependency.

## Small programs

```sh
bun examples/code-to-svg.ts [file] [out.svg]
bun examples/snippet.ts [file] [start] [end] [theme] [out.png]
bun examples/command-output.ts ["command"] [out.png]
```

- **code-to-svg.ts**: `renderSVG({ file, config: 'full' })` and nothing else.
  The language comes from the file name, by chroma's rules.
- **snippet.ts**: `renderPNG` with `lines` (1-indexed, inclusive), a theme and
  line numbers that keep their real values.
- **command-output.ts**: `freezeCommand` runs the command in a terminal (Bun's
  built-in one, or `script(1)` under Node.js) and `encode` turns the result
  into PNG bytes. Pass `--no-pager` to git, or it opens a pager in the terminal
  and waits until the timeout.

`samples/` holds the source files the examples and the README images use.

## Larger programs

### studio.ts

```sh
bun examples/studio.ts [dir] [--out dir]
```

A full-screen snapshot studio. The left pane lists the source files under
`dir` (default `examples/samples`, up to three levels deep and 400 files) that
chroma recognises; the middle pane previews the selected file in the terminal
with the chosen theme, window controls, line numbers, shadow and line range;
the right pane holds the options and the pixel size of the image they produce.
`e` exports to `--out` (default `./freeze-out`) as `<file>-<theme>.<format>`.

| Key | Action |
|---|---|
| `tab` | switch between the file list and the options |
| `↑`/`↓`, `j`/`k` | move in the focused pane |
| `←`/`→`, `h`/`l` | change the selected option; in the file list, change the theme |
| `t` / `T` | next / previous theme from anywhere |
| `space` | toggle the selected option |
| `/` | filter files by name or language (`enter` keeps, `esc` clears) |
| `pgup` / `pgdn`, mouse wheel | scroll the preview |
| `e` or `enter` | export |
| `q`, `ctrl+c` | quit |

The options: theme (all 75), window controls, line numbers, shadow, corner
radius, padding (four presets), first and last line, font size, and format
(PNG, SVG, WebP). Export runs as a Bubble Tea command, with a spinner while it
works and the path, size, bytes and time in the status line afterwards.

### social-cards.ts

```sh
bun examples/social-cards.ts [--out dir] [--webp]
```

Renders the list of cards at the top of the file in one go and writes
`manifest.json` next to them (file, language, theme, size, scale, bytes,
milliseconds). Fixed-size cards (1200×630 Open Graph, 1080×1080 square) are
drawn at 1x so the PNG is exactly that size, with a 24px font and the lines
that fit; auto-sized README images are drawn at 4x. Edit `CARDS` to make your
own set.

### tea-snapshot.ts

```sh
bun examples/tea-snapshot.ts                           # interactive: s saves the screen, q quits
bun examples/tea-snapshot.ts --headless [--png] [--out dir]
```

A release dashboard built with Bubble Tea, Bubbles (spinner, progress) and
Lip Gloss. Its `content()` is the view as a string with ANSI styling, which is
exactly what `freeze --execute` captures from a terminal, so it is rendered with
`origin: 'execute'`. Interactively, `s` writes `snapshots/dashboard-<tick>.svg`.
With `--headless` there is no terminal at all: the script calls `update()` with
the messages the program would receive and freezes the view at three moments.

## Recordings

`assets/tapes/*.tape` record the GIFs with [@oakoliver/vhs](https://github.com/oakoliver/vhs):

```sh
vhs assets/tapes/cli.tape          # assets/cli.gif
vhs assets/tapes/interactive.tape  # assets/interactive.gif
vhs assets/tapes/studio.tape       # assets/studio.gif
```

The tapes write to absolute paths under this checkout; edit the `Output`
lines if you clone it elsewhere.
