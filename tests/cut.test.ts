// Port of upstream cut_test.go.
import { expect, test } from 'bun:test';
import { cut } from '../src/cut';

const input = `1 package main
2 
3 import (
4   "fmt"
5 )
6
7 func main() {
8    fmt.Println("Hello World")
9 }`;

const cases: Array<[string, number[], string]> = [
  ['', [0, 0], ''],
  ['Hello World', [0, 0], 'Hello World'],
  ['Hello World', [0, 1], 'Hello World'],
  ['Hello World', [0, 10], 'Hello World'],
  ['Hello World', [10, 10], ''],
  [input, [0, 10], input],
  [input, [0, 1], '1 package main\n2 '],
  [input, [1, 2], '2 \n3 import ('],
  [input, [2, 4], '3 import (\n4   "fmt"\n5 )'],
  [input, [6], '7 func main() {\n8    fmt.Println("Hello World")\n9 }'],
  [input, [-3], '7 func main() {\n8    fmt.Println("Hello World")\n9 }'],
  [input, [-2], '8    fmt.Println("Hello World")\n9 }'],
  [input, [-1], '9 }'],
  [input, [0, 9], input],
  [input, [6, 6], '7 func main() {'],
  [input, [7, 7], '8    fmt.Println("Hello World")'],
];

for (const [text, lines, expected] of cases) {
  test(`cut(${JSON.stringify(text.slice(0, 12))}…, [${lines}])`, () => {
    expect(cut(text, lines)).toBe(expected);
  });
}
