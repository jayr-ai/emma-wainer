import { svgEl } from '../components/dom.js';
import { smoothLinePath } from './smooth-path.js';

/**
 * A small decorative trend line for a KPI card. Decorative because the
 * card's own text (value + change + "vs N prior period") already states
 * the same trend information, so the SVG is hidden from assistive tech.
 */
function renderSparkline(values, { width = 150, height = 36 } = {}) {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height,
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'none',
  });

  if (!values || values.length === 0) return svg;

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pad = 2;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  const points = values.map((v, i) => {
    const x = pad + (values.length === 1 ? usableW / 2 : (i / (values.length - 1)) * usableW);
    const y = pad + usableH - ((v - min) / range) * usableH;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  svg.appendChild(svgEl('path', {
    d: smoothLinePath(points),
    fill: 'none',
    stroke: 'var(--brand-milky-tea-strong)',
    'stroke-width': '1.5',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  }));

  return svg;
}

export { renderSparkline };
