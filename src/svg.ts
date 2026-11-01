/**
 * svg.ts — port of charmbracelet/freeze svg/svg.go: window controls, shadows,
 * clip paths, corner radius, outlines and element geometry.
 */

import { goFixed } from './fmt.js';
import { XmlElement } from './xml.js';

const f2 = (n: number) => goFixed(n, 2);

/** AddShadow adds a <defs><filter id> drop shadow to element. */
export function addShadow(element: XmlElement, id: string, x: number, y: number, blur: number): void {
  const filter = new XmlElement('filter').setAttr('id', id).setAttr('filterUnits', 'userSpaceOnUse');
  filter.addChild(new XmlElement('feGaussianBlur').setAttr('in', 'SourceAlpha').setAttr('stdDeviation', f2(blur)));
  filter.addChild(new XmlElement('feOffset').setAttr('result', 'offsetblur').setAttr('dx', f2(x)).setAttr('dy', f2(y)));
  const merge = new XmlElement('feMerge');
  merge.addChild(new XmlElement('feMergeNode'));
  merge.addChild(new XmlElement('feMergeNode').setAttr('in', 'SourceGraphic'));
  filter.addChild(merge);
  element.addChild(new XmlElement('defs').addChild(filter));
}

/** AddClipPath adds a <defs><clipPath id> rectangle to element. */
export function addClipPath(element: XmlElement, id: string, x: number, y: number, w: number, h: number): void {
  const rect = new XmlElement('rect')
    .setAttr('x', f2(x)).setAttr('y', f2(y)).setAttr('width', f2(w)).setAttr('height', f2(h));
  element.addChild(new XmlElement('defs').addChild(new XmlElement('clipPath').setAttr('id', id).addChild(rect)));
}

/** AddCornerRadius rounds an element's corners. */
export function addCornerRadius(e: XmlElement, radius: number): void {
  e.setAttr('rx', f2(radius)).setAttr('ry', f2(radius));
}

/** Move sets an element's x and y in pixels. */
export function move(e: XmlElement, x: number, y: number): void {
  e.setAttr('x', `${f2(x)}px`).setAttr('y', `${f2(y)}px`);
}

/** AddOutline strokes an element. */
export function addOutline(e: XmlElement, width: number, color: string): void {
  e.setAttr('stroke', color).setAttr('stroke-width', f2(width));
}

const WINDOW_COLORS = ['#FF5A54', '#E6BF29', '#52C12B'];

/** NewWindowControls returns the three macOS-style window buttons. */
export function newWindowControls(r: number, x: number, y: number): XmlElement {
  const bar = new XmlElement('svg');
  WINDOW_COLORS.forEach((color, i) => {
    bar.addChild(new XmlElement('circle')
      .setAttr('cx', f2((i + 1) * x - r))
      .setAttr('cy', f2(y))
      .setAttr('r', f2(r))
      .setAttr('fill', color));
  });
  return bar;
}

/** SetDimensions sets width and height (the attributes must already exist). */
export function setDimensions(element: XmlElement, width: number, height: number): void {
  element.setAttr('height', f2(height));
  element.setAttr('width', f2(width));
}

/** GetDimensions parses "500px"-style width and height to integers (0 when unparsable). */
export function getDimensions(element: XmlElement): [number, number] {
  return [dimensionToInt(element.getAttr('width', '0px')), dimensionToInt(element.getAttr('height', '0px'))];
}

function dimensionToInt(px: string): number {
  const d = px.endsWith('px') ? px.slice(0, -2) : px;
  return /^[+-]?\d+$/.test(d) ? parseInt(d, 10) : 0;
}
