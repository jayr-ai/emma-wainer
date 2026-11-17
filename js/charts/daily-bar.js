import { el, clear, svgEl } from '../components/dom.js';
import { attachTooltip } from '../components/tooltip.js';
import { niceTicks, formatCompact } from './axis.js';

function labelFor(point, grouping) {
  const date = new Date(`${point.date}T00:00:00Z`);
  if (grouping === 'month') {
    return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });
  }
  const day = date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return grouping === 'week' ? `Week of ${day}` : day;
}

function axisLabelFor(point, grouping) {
  const date = new Date(`${point.date}T00:00:00Z`);
  if (grouping === 'month') return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/**
 * @param {HTMLElement} container
 * @param {{points: Array<{date:string, impressions:number, engagements:number, posts?:Array}>, grouping: 'day'|'week'|'month'}} data
 */
function renderDailyChart(container, { points, grouping }) {
  clear(container);

  if (!points || points.length === 0) {
    container.appendChild(el('p', { class: 'empty-state', text: 'No posts in this period.' }));
    return;
  }

  const width = 760;
  const height = 170;
  const marginLeft = 42;
  const marginRight = 8;
  const marginTop = 8;
  const marginBottom = 22;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;

  const maxImpressions = Math.max(...points.map((p) => p.impressions), 1);
  const ticks = niceTicks(maxImpressions, 4);
  const axisMax = ticks[ticks.length - 1] || maxImpressions;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    role: 'img',
    'aria-label': `Impressions per ${grouping}, selected period`,
  });

  for (const t of ticks) {
    const y = marginTop + plotH - (t / axisMax) * plotH;
    svg.appendChild(svgEl('line', { x1: marginLeft, x2: width - marginRight, y1: y, y2: y, class: 'gridline' }));
    svg.appendChild(svgEl('text', { x: marginLeft - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label', text: formatCompact(t) }));
  }

  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  points.forEach((point, i) => {
    const barH = (point.impressions / axisMax) * plotH;
    const x = marginLeft + i * slot + (slot - barW) / 2;
    const y = marginTop + plotH - barH;

    const rect = svgEl('rect', {
      x: x.toFixed(1), y: y.toFixed(1), width: barW.toFixed(1), height: Math.max(0, barH).toFixed(1),
      rx: 2, class: 'bar', tabindex: '0',
    });
    svg.appendChild(rect);
    attachTooltip(rect, () => {
      const titles = (point.posts || []).slice(0, 3).map((p) => p.title).join(' · ');
      const base = `${labelFor(point, grouping)}: ${formatCompact(point.impressions)} impressions, ${formatCompact(point.engagements)} engagements`;
      return titles ? `${base}\n${titles}` : base;
    });

    if (i % labelEvery === 0 || i === points.length - 1) {
      svg.appendChild(svgEl('text', {
        x: (marginLeft + i * slot + slot / 2).toFixed(1), y: height - 8, 'text-anchor': 'middle', class: 'axis-label',
        text: axisLabelFor(point, grouping),
      }));
    }
  });

  container.appendChild(svg);

  const table = el('table', { class: 'visually-hidden' }, [
    el('caption', { text: `Impressions and engagements per ${grouping}` }),
    el('thead', {}, el('tr', {}, [el('th', { text: 'Period' }), el('th', { text: 'Impressions' }), el('th', { text: 'Engagements' })])),
    el('tbody', {}, points.map((p) => el('tr', {}, [
      el('td', { text: labelFor(p, grouping) }),
      el('td', { text: String(p.impressions) }),
      el('td', { text: String(p.engagements) }),
    ]))),
  ]);
  container.appendChild(table);
}

export { renderDailyChart };
