/**
 * cut.ts — port of charmbracelet/freeze cut.go: select a window of lines.
 *
 * `window` is zero-indexed: [start] keeps from start to the end (a negative
 * start counts from the end), [start, end] keeps start..end inclusive.
 */
export function cut(input: string, window: number[]): string {
  if (window.length === 0) return input;
  if (window.length === 1 && window[0] === 0) return input;
  if (window.length === 2 && window[0] === 0 && window[1] === -1) return input;

  const lines = input.split('\n');
  let start = 0;
  let end = lines.length;

  if (window.length === 1) {
    start = window[0] > 0 ? window[0] : lines.length + window[0];
  } else if (window.length === 2) {
    start = window[0];
    end = window[1];
  }

  start = clamp(start, 0, lines.length);
  end = clamp(end + 1, start, lines.length);

  if (start === end && start < lines.length) return lines[start];
  return lines.slice(start, end).join('\n');
}

export function clamp(n: number, low: number, high: number): number {
  return Math.min(Math.max(n, low), high);
}
