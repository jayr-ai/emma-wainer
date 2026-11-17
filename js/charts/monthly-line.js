import { el, clear, svgEl } from '../components/dom.js';
import { attachTooltip } from '../components/tooltip.js';
import { niceTicks } from './axis.js';

function monthLabel(monthKey) {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' });
}

/**
 * @param {HTMLElement} container
 * @param {{points: Array<{month:string, medianRate:number|null}>, highlight: {from:string, to:string}}} data
 *   highlight.from/to are 'YYYY-MM' month keys marking the selected range.
 */
function renderMonthlyChart(container, { points, highlight }) {
  clear(container);

  const plotted = points.filter((p) => p.medianRate !== null);
  if (plotted.length === 0) {
    container.appendChild(el('p', { class: 'empty-state', text: 'No data yet.' }));
    return;
  }

  const width = 420;
  const height = 220;
  const marginLeft = 36;
  const marginRight = 8;
  const marginTop = 10;
  const marginBottom = 26;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;

  const maxRate = Math.max(...plotted.map((p) => p.medianRate), 0.01);
  const ticks = niceTicks(maxRate * 100, 4).map((t) => t / 100);
  const axisMax = ticks[ticks.length - 1] || maxRate;

  const n = points.length;
  const xFor = (i) => marginLeft + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (rate) => marginTop + plotH - (rate / axisMax) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    role: 'img',
    'aria-label': 'Median per-post engagement rate by month, full history',
  });

  if (highlight) {
    const fromIdx = points.findIndex((p) => p.month === highlight.from);
    const toIdx = points.findIndex((p) => p.month === highlight.to);
    if (fromIdx !== -1 && toIdx !== -1) {
      const x1 = xFor(fromIdx) - plotW / Math.max(1, n - 1) / 2;
      const x2 = xFor(toIdx) + plotW / Math.max(1, n - 1) / 2;
      svg.appendChild(svgEl('rect', {
        x: Math.max(marginLeft, x1).toFixed(1), y: marginTop,
        width: Math.max(0, Math.min(width - marginRight, x2) - Math.max(marginLeft, x1)).toFixed(1),
        height: plotH, class: 'trend-band',
      }));
    }
  }

  for (const t of ticks) {
    const y = yFor(t);
    svg.appendChild(svgEl('line', { x1: marginLeft, x2: width - marginRight, y1: y, y2: y, class: 'gridline' }));
    svg.appendChild(svgEl('text', { x: marginLeft - 6, y: y + 4, 'text-anchor': 'end', class: 'axis-label' }, el('tspan', { text: `${(t * 100).toFixed(0)}%` })));
  }

  let pathData = '';
  points.forEach((p, i) => {
    if (p.medianRate === null) return;
    const cmd = pathData === '' ? 'M' : 'L';
    pathData += `${cmd}${xFor(i).toFixed(1)},${yFor(p.medianRate).toFixed(1)} `;
  });
  svg.appendChild(svgEl('path', { d: pathData.trim(), class: 'trend-line' }));

  const labelEvery = Math.max(1, Math.ceil(n / 7));
  points.forEach((p, i) => {
    if (p.medianRate === null) return;
    const dot = svgEl('circle', { cx: xFor(i).toFixed(1), cy: yFor(p.medianRate).toFixed(1), r: 3.2, class: 'trend-dot', tabindex: '0' });
    svg.appendChild(dot);
    attachTooltip(dot, () => `${monthLabel(p.month)}: ${(p.medianRate * 100).toFixed(1)}% median engagement rate`);

    if (i % labelEvery === 0 || i === n - 1) {
      svg.appendChild(svgEl('text', { x: xFor(i).toFixed(1), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' }, el('tspan', { text: monthLabel(p.month) })));
    }
  });

  container.appendChild(svg);

  const table = el('table', { class: 'visually-hidden' }, [
    el('caption', { text: 'Median per-post engagement rate by month' }),
    el('thead', {}, el('tr', {}, [el('th', { text: 'Month' }), el('th', { text: 'Median engagement rate' })])),
    el('tbody', {}, points.map((p) => el('tr', {}, [
      el('td', { text: monthLabel(p.month) }),
      el('td', { text: p.medianRate === null ? 'No data' : `${(p.medianRate * 100).toFixed(1)}%` }),
    ]))),
  ]);
  container.appendChild(table);
}

export { renderMonthlyChart };
