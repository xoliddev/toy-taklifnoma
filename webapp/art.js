// Every ornament on the invitation is drawn here, in code: no stock images, nothing downloaded.
//  * milliy — an eight-pointed girih star lattice (the kind on Samarkand tiles) and an islimi-like vine divider;
//  * oltin — a minimal art-deco fan and fine gold rules;
//  * bahor — five-petal blossoms and leaves, scattered with a seeded random so every invitation looks the same.
import { s } from './util.js';

const r2 = (x) => Math.round(x * 100) / 100;

/** An 8-pointed star of two squares, centred at (cx, cy). */
function star8(cx, cy, R) {
  const pts = [];
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI / 8) * k - Math.PI / 2;
    const rr = k % 2 ? R * 0.62 : R;
    pts.push(`${r2(cx + rr * Math.cos(a))},${r2(cy + rr * Math.sin(a))}`);
  }
  return pts.join(' ');
}

/** The girih tile used as a repeating background (an SVG <pattern>). */
export function girihPattern(id, color = 'currentColor', size = 64) {
  const c = size / 2;
  const tile = s('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' },
    s('polygon', { points: star8(c, c, size * 0.34), fill: 'none', stroke: color, 'stroke-width': 1 }),
    s('polygon', { points: star8(c, c, size * 0.17), fill: color, 'fill-opacity': 0.35 }),
    ...[[0, 0], [size, 0], [0, size], [size, size]].map(([x, y]) => s('polygon', { points: star8(x, y, size * 0.2), fill: 'none',
      stroke: color, 'stroke-width': 1 })),
    s('path', { d: `M${c} 0V${size * 0.16}M${c} ${size * 0.84}V${size}M0 ${c}H${size * 0.16}M${size * 0.84} ${c}H${size}`,
      stroke: color, 'stroke-width': 1 }));
  return tile;
}

/** A full-bleed background layer with the theme's pattern. */
export function backdrop(theme) {
  const svg = s('svg', { class: 'inv-backdrop', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid slice' });
  const defs = s('defs');
  svg.append(defs);
  if (theme === 'milliy') {
    defs.append(girihPattern('tt-girih', 'currentColor', 72));
    svg.append(s('rect', { width: '100%', height: '100%', fill: 'url(#tt-girih)' }));
  } else if (theme === 'bahor') {
    svg.setAttribute('viewBox', '0 0 400 900');
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let k = 0; k < 26; k++) {
      const x = rnd() * 400;
      const y = rnd() * 900;
      svg.append(rnd() < 0.55 ? blossom(x, y, 8 + rnd() * 12, rnd() * 72, k % 3) : leaf(x, y, 10 + rnd() * 14, rnd() * 360));
    }
  } else {
    svg.setAttribute('viewBox', '0 0 400 900');
    for (let k = 0; k < 9; k++) svg.append(s('circle', { cx: 200, cy: 450, r: 60 + k * 70, fill: 'none', stroke: 'currentColor', 'stroke-width': 0.6 }));
  }
  return svg;
}

export function blossom(cx, cy, r, rot = 0, tint = 0) {
  const g = s('g', { transform: `translate(${r2(cx)} ${r2(cy)}) rotate(${r2(rot)})`, class: `bloom t${tint}` });
  for (let k = 0; k < 5; k++) {
    g.append(s('ellipse', { cx: 0, cy: r2(-r * 0.55), rx: r2(r * 0.42), ry: r2(r * 0.62), transform: `rotate(${k * 72})`, class: 'petal' }));
  }
  g.append(s('circle', { r: r2(r * 0.22), class: 'pistil' }));
  return g;
}

export function leaf(cx, cy, len, rot) {
  return s('path', { class: 'leafy', transform: `translate(${r2(cx)} ${r2(cy)}) rotate(${r2(rot)})`,
    d: `M0 0C${r2(len * 0.35)} ${r2(-len * 0.45)} ${r2(len * 0.8)} ${r2(-len * 0.35)} ${r2(len)} 0C${r2(len * 0.8)} ${r2(len * 0.35)} ${r2(len * 0.35)} ${r2(len * 0.45)} 0 0Z` });
}

/** A horizontal divider for the section headings, different per theme. */
export function divider(theme) {
  const svg = s('svg', { class: 'inv-divider', viewBox: '0 0 240 24', 'aria-hidden': 'true' });
  if (theme === 'milliy') {
    svg.append(s('path', { d: 'M8 12C40 2 70 22 100 12M232 12C200 2 170 22 140 12', class: 'line' }),
      s('polygon', { points: star8(120, 12, 10), class: 'fill' }), s('circle', { cx: 120, cy: 12, r: 3, class: 'dot' }));
  } else if (theme === 'bahor') {
    svg.append(s('path', { d: 'M10 12H95M145 12H230', class: 'line' }), blossom(120, 12, 9, 10, 0), leaf(100, 12, 14, 200), leaf(140, 12, 14, -20));
  } else {
    svg.append(s('path', { d: 'M4 12H100M140 12H236', class: 'line' }), s('path', { d: 'M108 12L120 4L132 12L120 20Z', class: 'fill' }));
  }
  return svg;
}

/** The corner ornament of the invitation card. */
export function corner(theme, pos) {
  const svg = s('svg', { class: `inv-corner ${pos}`, viewBox: '0 0 120 120', 'aria-hidden': 'true' });
  if (theme === 'milliy') {
    svg.append(s('path', { d: 'M6 114V40Q6 6 40 6H114', class: 'line' }), s('path', { d: 'M16 114V48Q16 16 48 16H114', class: 'line thin' }),
      s('polygon', { points: star8(34, 34, 14), class: 'fill' }), s('circle', { cx: 34, cy: 34, r: 4, class: 'dot' }));
  } else if (theme === 'bahor') {
    svg.append(leaf(18, 70, 38, -70), leaf(60, 22, 36, -15), blossom(28, 28, 18, 12, 0), blossom(70, 50, 10, 40, 1), blossom(40, 80, 8, 70, 2));
  } else {
    for (let k = 0; k < 5; k++) svg.append(s('path', { d: `M6 ${40 + k * 16}A${30 + k * 16} ${30 + k * 16} 0 0 1 ${40 + k * 16} 6`, class: 'line thin' }));
    svg.append(s('path', { d: 'M6 114V6H114', class: 'line' }));
  }
  return svg;
}

/** The wax seal on the envelope, with the couple's initials. */
export function seal(a, b) {
  const svg = s('svg', { class: 'env-seal', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const wobble = [];
  for (let k = 0; k < 24; k++) {
    const ang = (Math.PI / 12) * k;
    const rr = k % 2 ? 44 : 47;
    wobble.push(`${r2(50 + rr * Math.cos(ang))},${r2(50 + rr * Math.sin(ang))}`);
  }
  svg.append(s('polygon', { points: wobble.join(' '), class: 'wax' }), s('circle', { cx: 50, cy: 50, r: 34, class: 'ring' }),
    s('text', { x: 50, y: 58, 'text-anchor': 'middle', class: 'mono' }, `${a.slice(0, 1)}&${b.slice(0, 1)}`));
  return svg;
}
