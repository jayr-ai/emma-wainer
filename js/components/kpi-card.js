import { el } from './dom.js';
import { renderSparkline } from '../charts/sparkline.js';

/**
 * change is one of:
 *   null                                             -> compare is off, no row shown
 *   { state: 'no-earlier' }                          -> "All time" preset
 *   { state: 'new' }                                 -> previous period had no data
 *   { state: 'pct', direction, text, captionText }   -> relative % change
 *   { state: 'points', direction, text, captionText } -> percentage-point change (rate metrics)
 */
function renderChangeRow(change) {
  if (!change) return null;
  if (change.state === 'no-earlier') {
    return el('span', { class: 'kpi-change' }, el('span', { class: 'caption', text: 'No earlier period' }));
  }
  if (change.state === 'new') {
    return el('span', { class: 'kpi-change' }, el('b', { text: 'New' }));
  }
  if (change.state === 'untracked') {
    return el('span', { class: 'kpi-change' }, el('span', { class: 'caption', text: 'Not tracked in this period' }));
  }
  const arrowClass = change.direction === 'up' ? 'arrow-up' : change.direction === 'down' ? 'arrow-down' : 'caption';
  const glyph = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '–';
  return el('span', { class: 'kpi-change' }, [
    el('b', { class: arrowClass, text: `${glyph} ${change.text}` }),
    el('span', { class: 'caption', text: change.captionText }),
  ]);
}

function renderKpiCard({ id, label, valueText, change, sparklineValues, tooltip }) {
  const labelChildren = [label];
  if (tooltip) {
    labelChildren.push(el('button', {
      type: 'button',
      class: 'info-dot',
      text: 'i',
      'aria-label': `What this metric means: ${tooltip}`,
      title: tooltip,
    }));
  }

  const card = el('div', { class: 'kpi-card', id, 'data-kpi-updated': 'false' }, [
    el('span', { class: 'kpi-label' }, labelChildren),
    el('span', { class: 'kpi-value', text: valueText }),
    renderChangeRow(change),
    el('div', { class: 'kpi-spark' }, sparklineValues && sparklineValues.length
      ? renderSparkline(sparklineValues, { height: 24 })
      : null),
  ]);

  return card;
}

function flashUpdated(cardNode) {
  cardNode.classList.add('kpi-updated');
  window.setTimeout(() => cardNode.classList.remove('kpi-updated'), 1200);
}

export { renderKpiCard, flashUpdated };
