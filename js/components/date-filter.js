// The date filter: presets, a two-month calendar popover for custom ranges,
// a compare checkbox and a refresh button. Fully keyboard operable.

import { el, clear } from './dom.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESETS = [
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'all', label: 'All time' },
];
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toKey(date) {
  return date.toISOString().slice(0, 10);
}

function fromKey(key) {
  return new Date(`${key}T00:00:00Z`);
}

function clampDate(date, bounds) {
  if (date.getTime() < bounds.first.getTime()) return new Date(bounds.first);
  if (date.getTime() > bounds.last.getTime()) return new Date(bounds.last);
  return date;
}

function formatLong(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Range for a preset, anchored to the latest date in the data (not today). */
function computeRange(preset, bounds, custom) {
  const anchor = bounds.last;
  if (preset === 'custom' && custom) {
    return {
      from: clampDate(fromKey(custom.from), bounds),
      to: clampDate(fromKey(custom.to), bounds),
    };
  }
  if (preset === 'all') {
    return { from: new Date(bounds.first), to: new Date(bounds.last) };
  }
  if (preset === 'ytd') {
    const jan1 = new Date(`${anchor.getUTCFullYear()}-01-01T00:00:00Z`);
    return { from: clampDate(jan1, bounds), to: new Date(anchor) };
  }
  const days = preset === '90d' ? 90 : 30;
  const from = new Date(anchor.getTime() - (days - 1) * DAY_MS);
  return { from: clampDate(from, bounds), to: new Date(anchor) };
}

/** Range of identical length ending the day before `from`. Null for "all time". */
function computePreviousRange(preset, from, to) {
  if (preset === 'all') return null;
  const lengthDays = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  const prevTo = new Date(from.getTime() - DAY_MS);
  const prevFrom = new Date(prevTo.getTime() - (lengthDays - 1) * DAY_MS);
  return { from: prevFrom, to: prevTo };
}

function parseStateFromUrl(bounds) {
  const params = new URLSearchParams(window.location.search);
  const compare = params.get('compare') !== '0';
  const presetParam = params.get('preset');
  const from = params.get('from');
  const to = params.get('to');

  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { preset: 'custom', custom: { from, to }, compare };
  }
  if (presetParam && PRESETS.some((p) => p.key === presetParam)) {
    return { preset: presetParam, custom: null, compare };
  }
  return { preset: '30d', custom: null, compare };
}

function writeStateToUrl(state, range) {
  const params = new URLSearchParams();
  if (state.preset === 'custom') {
    params.set('from', toKey(range.from));
    params.set('to', toKey(range.to));
  } else {
    params.set('preset', state.preset);
  }
  if (!state.compare) params.set('compare', '0');
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', newUrl);
}

function buildMonthTable(year, month, { bounds, selStart, selEnd, hoverKey, onPick, monthId }) {
  const first = new Date(Date.UTC(year, month, 1));
  const startWeekday = (first.getUTCDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const caption = el('caption', { text: `${MONTH_LABELS[month]} ${year}` });
  const thead = el('thead', {}, [
    el('tr', {}, WEEKDAY_LABELS.map((w) => el('th', { scope: 'col', text: w }))),
  ]);

  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(el('td', {}, el('span')));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month, day));
    const key = toKey(date);
    const outOfBounds = date.getTime() < bounds.first.getTime() || date.getTime() > bounds.last.getTime();
    const isStart = selStart === key;
    const isEnd = selEnd === key;
    const inRange = selStart && selEnd && key > selStart && key < selEnd;

    const classes = ['calendar-day'];
    if (isStart || isEnd) classes.push('is-endpoint');
    else if (inRange) classes.push('in-range');

    const button = el('button', {
      type: 'button',
      class: classes.join(' '),
      text: String(day),
      'aria-label': formatLong(date),
      'aria-pressed': isStart || isEnd ? 'true' : null,
      disabled: outOfBounds,
      tabindex: key === hoverKey ? '0' : '-1',
      dataset: { dateKey: key, monthId },
      onClick: () => onPick(key),
    });
    cells.push(el('td', {}, button));
  }

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(el('tr', {}, cells.slice(i, i + 7)));
  }

  return el('table', { role: 'grid', 'aria-label': `${MONTH_LABELS[month]} ${year}` }, [
    caption,
    thead,
    el('tbody', {}, rows),
  ]);
}

/**
 * @param {HTMLElement} container
 * @param {{bounds: {first: Date, last: Date}, initialState: object, onChange: Function, onRefresh: Function}} opts
 */
function createDateFilter(container, { bounds, initialState, onChange, onRefresh }) {
  let state = initialState;
  let currentBounds = bounds;
  let popoverOpen = false;
  let pendingStart = null;
  let pendingEnd = null;
  let viewYear;
  let viewMonth;

  function rangeForState() {
    return computeRange(state.preset, currentBounds, state.custom);
  }

  function resetCalendarView() {
    const range = rangeForState();
    viewYear = range.from.getUTCFullYear();
    viewMonth = range.from.getUTCMonth();
    pendingStart = toKey(range.from);
    pendingEnd = toKey(range.to);
  }

  function commit(newState) {
    state = newState;
    const range = computeRange(state.preset, currentBounds, state.custom);
    writeStateToUrl(state, range);
    popoverOpen = false;
    render();
    onChange(state);
  }

  function handlePick(key) {
    if (!pendingStart || (pendingStart && pendingEnd && pendingStart !== pendingEnd)) {
      pendingStart = key;
      pendingEnd = key;
      renderPopover();
      return;
    }
    if (key < pendingStart) {
      pendingEnd = pendingStart;
      pendingStart = key;
    } else {
      pendingEnd = key;
    }
    if (pendingStart === pendingEnd) {
      renderPopover();
      return;
    }
    commit({ ...state, preset: 'custom', custom: { from: pendingStart, to: pendingEnd } });
  }

  function renderPopover() {
    const existing = container.querySelector('.date-range-popover');
    if (existing) existing.remove();
    if (!popoverOpen) return;

    const prevBtn = el('button', {
      type: 'button',
      'aria-label': 'Previous month',
      onClick: () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        renderPopover();
      },
    }, '‹');
    const nextBtn = el('button', {
      type: 'button',
      'aria-label': 'Next month',
      onClick: () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        renderPopover();
      },
    }, '›');

    const secondMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const secondYear = viewMonth === 11 ? viewYear + 1 : viewYear;

    const monthA = buildMonthTable(viewYear, viewMonth, {
      bounds: currentBounds, selStart: pendingStart, selEnd: pendingEnd,
      hoverKey: pendingStart, onPick: handlePick, monthId: 'a',
    });
    const monthB = buildMonthTable(secondYear, secondMonth, {
      bounds: currentBounds, selStart: pendingStart, selEnd: pendingEnd,
      hoverKey: pendingStart, onPick: handlePick, monthId: 'b',
    });

    const popover = el('div', {
      class: 'date-range-popover',
      role: 'dialog',
      'aria-label': 'Choose a custom date range',
      onKeydown: handlePopoverKeydown,
    }, [
      el('div', { class: 'calendar-nav' }, [prevBtn, el('span', { class: 'visually-hidden', text: 'Calendar' }), nextBtn]),
      el('div', { class: 'calendar-months' }, [
        el('div', { class: 'calendar-month' }, monthA),
        el('div', { class: 'calendar-month' }, monthB),
      ]),
      el('div', { class: 'calendar-actions' }, [
        el('button', {
          type: 'button', class: 'btn',
          onClick: () => { popoverOpen = false; render(); },
          text: 'Cancel',
        }),
      ]),
    ]);

    container.appendChild(popover);
    const firstEnabled = popover.querySelector('.calendar-day:not(:disabled)');
    if (firstEnabled) firstEnabled.focus();
  }

  function handlePopoverKeydown(e) {
    if (e.key === 'Escape') {
      popoverOpen = false;
      render();
      return;
    }
    const target = e.target;
    if (!target.classList || !target.classList.contains('calendar-day')) return;
    const allDays = Array.from(container.querySelectorAll('.calendar-day:not(:disabled)'));
    const idx = allDays.indexOf(target);
    if (idx === -1) return;

    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (moves[e.key] !== undefined) {
      e.preventDefault();
      const next = allDays[idx + moves[e.key]];
      if (next) { next.setAttribute('tabindex', '0'); target.setAttribute('tabindex', '-1'); next.focus(); }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      target.click();
    }
  }

  function render() {
    clear(container);

    const presetGroup = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Date range presets' },
      PRESETS.map((p) => el('button', {
        type: 'button',
        'aria-pressed': state.preset === p.key ? 'true' : 'false',
        text: p.label,
        onClick: () => {
          popoverOpen = false;
          commit({ ...state, preset: p.key, custom: null });
        },
      })));

    const range = rangeForState();
    const rangeLabel = `${formatLong(range.from)} – ${formatLong(range.to)}`;
    const rangeButton = el('button', {
      type: 'button',
      class: 'btn',
      'aria-haspopup': 'dialog',
      'aria-expanded': popoverOpen ? 'true' : 'false',
      onClick: () => {
        popoverOpen = !popoverOpen;
        if (popoverOpen) resetCalendarView();
        render();
      },
    }, [
      el('span', { 'aria-hidden': 'true', text: '\u{1F4C5} ' }),
      rangeLabel,
    ]);

    const compareLabel = el('label', { class: 'checkbox-label' }, [
      el('input', {
        type: 'checkbox',
        checked: state.compare,
        onChange: (e) => commit({ ...state, compare: e.target.checked }),
      }),
      'Compare to previous period',
    ]);

    const refreshButton = el('button', {
      type: 'button',
      class: 'btn btn-icon',
      id: 'refresh-data-button',
      'aria-label': 'Refresh data. New data is checked automatically.',
      title: 'Refresh data',
      onClick: () => onRefresh && onRefresh(),
    }, '⟳');

    container.append(presetGroup, rangeButton, compareLabel, refreshButton);
    renderPopover();
  }

  render();

  return {
    getState: () => state,
    getRange: rangeForState,
    setBounds(newBounds) {
      currentBounds = newBounds;
      // Re-anchoring presets is implicit: computeRange reads currentBounds.last.
      render();
    },
    setExternalState(newState) {
      state = newState;
      render();
    },
  };
}

export { createDateFilter, computeRange, computePreviousRange, parseStateFromUrl, PRESETS };
