import { el, clear } from '../components/dom.js';
import { attachTooltip } from '../components/tooltip.js';
import { formatCompact } from './axis.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function formatDay(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/**
 * @param {HTMLElement} container
 * @param {Array<Array<{date:string, impressions:number}>>} grid weeks x [Mon..Fri]
 */
function renderRhythmGrid(container, grid) {
  clear(container);

  const allValues = grid.flat().map((c) => c.impressions);
  const max = Math.max(...allValues, 0);

  const headerRow = el('div', { class: 'rhythm-week', role: 'presentation' },
    WEEKDAYS.map((w) => el('span', { class: 'rhythm-weekday', text: w, 'aria-hidden': 'true' })));

  const weekRows = grid.map((week) => el('div', { class: 'rhythm-week' },
    week.map((cell) => {
      const ratio = max > 0 ? Math.sqrt(cell.impressions / max) : 0;
      const fill = el('div', { class: 'rhythm-cell-fill', style: `opacity:${ratio.toFixed(2)}` });
      const cellNode = el('div', {
        class: 'rhythm-cell',
        tabindex: '0',
        role: 'img',
        'aria-label': `${formatDay(cell.date)}: ${formatCompact(cell.impressions)} impressions`,
      }, fill);
      attachTooltip(cellNode, () => `${formatDay(cell.date)}: ${formatCompact(cell.impressions)} impressions`, { accessibleName: false });
      return cellNode;
    })));

  container.append(headerRow, ...weekRows);
}

export { renderRhythmGrid };
