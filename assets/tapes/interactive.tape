# Render from the repo root: vhs assets/tapes/interactive.tape
Output "/Users/oliveiraantoniocc/Documents/projects/freeze/assets/interactive.gif"

Set Shell bash
Set FontSize 16
Set Width 760
Set Height 880
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "export PS1='> ' XDG_CONFIG_HOME=/tmp/freeze-demo/config && alias freeze='bun src/cli.ts' && mkdir -p /tmp/freeze-demo && clear"
Enter
Show

Type "freeze --interactive examples/samples/fib.go"
Sleep 300ms
Enter
Sleep 1.5s

# Output name, then the theme picker.
Ctrl+U
Type "/tmp/freeze-demo/fib.png"
Sleep 400ms
Tab
Sleep 600ms
Right@350ms 6
Sleep 600ms
Tab
Sleep 400ms
# Padding and margin.
Ctrl+U
Type "20 30"
Tab
Ctrl+U
Type "30"
Tab
Sleep 400ms
# Window controls on.
Left
Sleep 500ms
Tab@250ms 4
Sleep 400ms
# Border radius 10, then shadow blur 20, y 10.
Ctrl+U
Type "10"
Tab@250ms 3
Ctrl+U
Type "20"
Tab@250ms 2
Ctrl+U
Type "10"
Sleep 800ms
Enter
Sleep 2.5s
