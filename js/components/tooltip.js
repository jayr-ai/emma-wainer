// A single shared tooltip, shown on hover AND on keyboard focus so chart
// marks and truncated text remain inspectable without a mouse.

import { el } from './dom.js';

let tooltipNode = null;

function ensureTooltip() {
  if (tooltipNode) return tooltipNode;
  tooltipNode = el('div', { class: 'tooltip', role: 'tooltip', id: 'shared-tooltip' });
  tooltipNode.hidden = true;
  document.body.appendChild(tooltipNode);
  return tooltipNode;
}

function showTooltip(target, text) {
  const tip = ensureTooltip();
  tip.textContent = text;
  tip.hidden = false;
  const rect = target.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - 270;
  if (left > maxLeft) left = Math.max(8, maxLeft);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

function hideTooltip() {
  if (tooltipNode) tooltipNode.hidden = true;
}

/**
 * Wires hover + keyboard-focus tooltip behaviour onto a target element.
 * `getText` is called lazily so the label can depend on live state.
 */
function attachTooltip(target, getText, { accessibleName = true } = {}) {
  if (accessibleName) {
    target.setAttribute('aria-describedby', 'shared-tooltip');
  }
  if (!target.hasAttribute('tabindex') && target.tagName !== 'BUTTON' && target.tagName !== 'A') {
    target.setAttribute('tabindex', '0');
  }
  target.addEventListener('mouseenter', () => showTooltip(target, getText()));
  target.addEventListener('mouseleave', hideTooltip);
  target.addEventListener('focus', () => showTooltip(target, getText()));
  target.addEventListener('blur', hideTooltip);
  target.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTooltip();
  });
}

export { attachTooltip, showTooltip, hideTooltip };
