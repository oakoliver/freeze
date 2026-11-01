# Render from the repo root: vhs assets/tapes/studio.tape
Output "/Users/oliveiraantoniocc/Documents/projects/freeze/assets/studio.gif"

Set Shell bash
Set FontSize 16
Set Width 1400
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' && rm -rf /tmp/freeze-demo/out && clear"
Enter
Show

Type "bun examples/studio.ts --out /tmp/freeze-demo/out"
Sleep 300ms
Enter
Sleep 1.8s

# Walk the files.
Down@500ms 2
Sleep 800ms

# Cycle themes from the file list.
Right@450ms 5
Sleep 800ms

# Options: line numbers on, a narrower line range.
Tab
Sleep 400ms
Down@300ms 2
Space
Sleep 700ms
Down@300ms 4
Right@250ms 7
Sleep 500ms
Down
Right@250ms 6
Sleep 900ms

# Export as PNG.
Type "e"
Sleep 2.2s

# Filter to the Rust file and export as WebP.
Type "/"
Sleep 300ms
Type "rs"
Sleep 500ms
Enter
Sleep 600ms
Left@300ms 2
Sleep 400ms
# Format: PNG -> SVG -> WebP.
Tab
Down@300ms 2
Right@400ms 2
Sleep 600ms
Type "e"
Sleep 2s
Type "q"
Sleep 500ms
