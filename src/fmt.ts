/**
 * fmt.ts — Go's fmt number formatting where it differs from JavaScript's.
 *
 * Go formats %.Nf from the exact binary value and rounds halfway cases to
 * even; Number.prototype.toFixed rounds them up. SVG attributes are written
 * with %.2f, so this matters for byte-identical output.
 */

/** fmt.Sprintf("%.<prec>f", x). */
export function goFixed(x: number, prec: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? '+Inf' : '-Inf';
  const negative = x < 0 || Object.is(x, -0);
  // toFixed(100) is the exact decimal expansion of the double (|x| < 1e21).
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf('.');
  const intPart = exact.slice(0, dot);
  const frac = exact.slice(dot + 1);
  const kept = intPart + frac.slice(0, prec);
  const rest = frac.slice(prec);
  let roundUp = false;
  if (rest[0] > '5') roundUp = true;
  else if (rest[0] === '5') {
    if (/[1-9]/.test(rest.slice(1))) roundUp = true;
    else roundUp = Number(kept[kept.length - 1]) % 2 === 1; // halfway: to even
  }
  let digits = kept;
  if (roundUp) {
    const arr = digits.split('').map(Number);
    let i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === 9) { arr[i] = 0; i--; } else { arr[i]++; break; }
    }
    if (i < 0) arr.unshift(1);
    digits = arr.join('');
  }
  const whole = digits.slice(0, digits.length - prec) || '0';
  const decimals = digits.slice(digits.length - prec);
  return (negative ? '-' : '') + whole.replace(/^0+(?=\d)/, '') + (prec > 0 ? '.' + decimals : '');
}

/** fmt.Sprintf("%3d", n) and friends: right-aligned integer. */
export function goPadInt(n: number, width: number): string {
  return String(Math.trunc(n)).padStart(width, ' ');
}

/** fmt.Sprintf("%02x", n) for an int (negative numbers keep their sign). */
export function goHex2(n: number): string {
  return n < 0 ? '-' + (-n).toString(16) : n.toString(16).padStart(2, '0');
}
