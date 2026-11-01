# Render from the repo root: vhs assets/tapes/cli.tape
Output "/Users/oliveiraantoniocc/Documents/projects/freeze/assets/cli.gif"

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 520
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' && alias freeze='bun src/cli.ts' && mkdir -p /tmp/freeze-demo && clear"
Enter
Show

# A code file to a PNG with the full preset (window, border, shadow).
Type "freeze examples/samples/fib.go --config full -o /tmp/freeze-demo/fib.png"
Sleep 300ms
Enter
Sleep 1.6s

# A few lines with a theme and line numbers, as SVG.
Type "freeze examples/samples/server.ts -t dracula --lines 8,18 --show-line-numbers -o /tmp/freeze-demo/server.svg"
Sleep 300ms
Enter
Sleep 1.4s

# A command's coloured output, captured through a terminal, as WebP.
Type "freeze -x 'bun test tests/cut.test.ts' -o /tmp/freeze-demo/test.webp"
Sleep 300ms
Enter
Sleep 2.6s

Type "ls -lh /tmp/freeze-demo"
Enter
Sleep 2.5s
