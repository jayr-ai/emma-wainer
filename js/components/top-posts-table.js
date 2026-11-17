import { el, clear, replaceChildren } from './dom.js';
import { attachTooltip } from './tooltip.js';
import { perPostEngagementRate } from '../metrics.js';

const PAGE_SIZE = 6;
const MAX_ROWS = 25;
const MIN_IMPRESSIONS_FOR_RATE = 200;

const COLUMNS = [
  { key: 'date', label: 'Date', numeric: false, defaultDir: 'desc' },
  { key: 'hook', label: 'Hook', numeric: false, defaultDir: 'asc' },
  { key: 'format', label: 'Format', numeric: false, defaultDir: 'asc' },
  { key: 'impressions', label: 'Impressions', numeric: true, defaultDir: 'desc' },
  { key: 'engagements', label: 'Engagements', numeric: true, defaultDir: 'desc' },
  { key: 'rate', label: 'Rate', numeric: true, defaultDir: 'desc' },
];

function sortValue(post, key) {
  if (key === 'hook') return post.title.toLowerCase();
  if (key === 'rate') return perPostEngagementRate(post) ?? -1;
  return post[key];
}

function formatPct(rate) {
  return rate === null ? '–' : `${(rate * 100).toFixed(1)}%`;
}

function createTopPostsTable(controlsContainer, tableContainer) {
  let posts = [];
  let sortColumn = 'impressions';
  let sortDirection = 'desc';
  let search = '';
  let visibleCount = PAGE_SIZE;

  function visiblePosts() {
    let rows = posts;
    if (sortColumn === 'rate') {
      rows = rows.filter((p) => p.impressions >= MIN_IMPRESSIONS_FOR_RATE);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) => p.title.toLowerCase().includes(q));
    }
    const dir = sortDirection === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const va = sortValue(a, sortColumn);
      const vb = sortValue(b, sortColumn);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return rows;
  }

  function setSort(column) {
    if (sortColumn === column) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = column;
      sortDirection = COLUMNS.find((c) => c.key === column).defaultDir;
    }
    visibleCount = PAGE_SIZE;
    renderAll();
  }

  function renderControls() {
    clear(controlsContainer);

    const chipReach = el('button', {
      type: 'button', class: 'chip', 'aria-pressed': sortColumn === 'impressions' ? 'true' : 'false',
      text: 'By reach',
      onClick: () => setSort('impressions'),
    });
    const chipRate = el('button', {
      type: 'button', class: 'chip', 'aria-pressed': sortColumn === 'rate' ? 'true' : 'false',
      text: 'By engagement rate',
      onClick: () => setSort('rate'),
    });
    const search_ = el('input', {
      type: 'search', class: 'search-input', placeholder: 'Search hooks…',
      'aria-label': 'Search post hooks', value: search,
      onInput: (e) => { search = e.target.value; visibleCount = PAGE_SIZE; renderAll(); },
    });

    controlsContainer.append(chipReach, chipRate, search_);
  }

  function renderTable() {
    clear(tableContainer);
    const rows = visiblePosts();

    if (rows.length === 0) {
      tableContainer.appendChild(el('p', { class: 'empty-state', text: 'No posts match this filter.' }));
      return;
    }

    const headerRow = el('tr', {}, COLUMNS.map((col) => {
      const isActive = sortColumn === col.key;
      const ariaSort = isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
      return el('th', { 'aria-sort': ariaSort, class: col.numeric ? 'col-num' : null }, el('button', {
        type: 'button',
        text: col.label + (isActive ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''),
        onClick: () => setSort(col.key),
      }));
    }));

    const shown = rows.slice(0, visibleCount);
    const bodyRows = shown.map((post) => {
      const hookCell = el('td', { class: 'hook-cell', text: post.title, tabindex: '0' });
      attachTooltip(hookCell, () => post.title);
      return el('tr', {}, [
        el('td', { text: post.date }),
        hookCell,
        el('td', { text: post.format }),
        el('td', { class: 'col-num', text: post.impressions.toLocaleString('en-US') }),
        el('td', { class: 'col-num', text: post.engagements.toLocaleString('en-US') }),
        el('td', { class: 'col-num', text: formatPct(perPostEngagementRate(post)) }),
      ]);
    });

    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, headerRow),
      el('tbody', {}, bodyRows),
    ]);
    tableContainer.appendChild(table);

    if (sortColumn === 'rate') {
      tableContainer.appendChild(el('p', { class: 'table-footnote', text: `Only posts with at least ${MIN_IMPRESSIONS_FOR_RATE} impressions are eligible for the rate sort.` }));
    }

    if (rows.length > visibleCount) {
      tableContainer.appendChild(el('div', { class: 'show-more-row' }, el('button', {
        type: 'button', class: 'btn',
        text: `Show more (${Math.min(rows.length, MAX_ROWS) - visibleCount} more)`,
        onClick: () => { visibleCount = Math.min(visibleCount + PAGE_SIZE, MAX_ROWS); renderTable(); },
      })));
    }
  }

  function renderAll() {
    renderControls();
    renderTable();
  }

  return {
    update(newPosts, { preserveState = false } = {}) {
      posts = newPosts;
      if (!preserveState) {
        search = '';
        visibleCount = PAGE_SIZE;
        sortColumn = 'impressions';
        sortDirection = 'desc';
      }
      renderAll();
    },
  };
}

export { createTopPostsTable };
