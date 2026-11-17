import { el, clear } from './dom.js';
import { formatCompact } from '../charts/axis.js';

function renderFormatPanel(container, groups) {
  clear(container);
  if (groups.length === 0) {
    container.appendChild(el('p', { class: 'empty-state', text: 'Not enough posts in this period to compare formats.' }));
    return;
  }
  const maxRate = Math.max(...groups.map((g) => g.medianRate || 0), 0.0001);
  for (const g of groups) {
    const widthPct = Math.max(4, (g.medianRate / maxRate) * 100);
    container.appendChild(el('div', { class: 'bar-row' }, [
      el('span', {}, [g.key, ' ', el('span', { class: 'bar-label-muted', text: `(${g.count})` })]),
      el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: `width:${widthPct.toFixed(0)}%` })),
      el('b', { class: 'bar-value', text: `${(g.medianRate * 100).toFixed(1)}%` }),
    ]));
  }
}

function renderTopicPanel(container, { topics, objectives }) {
  clear(container);
  const rows = [];
  const makeRow = (g) => el('div', { class: 'stat-row' }, [
    el('span', { text: g.key }),
    el('span', {
      class: 'stat-detail',
      text: `${g.count} post${g.count === 1 ? '' : 's'} · median ${g.medianImpressions ?? '–'} impr. · ${g.medianRate === null ? '–' : `${(g.medianRate * 100).toFixed(1)}%`}`,
    }),
  ]);
  for (const g of topics) rows.push(makeRow(g));
  for (const g of objectives) rows.push(makeRow(g));
  if (rows.length === 0) {
    container.appendChild(el('p', { class: 'empty-state', text: 'No posts in this period.' }));
    return;
  }
  container.append(...rows);
}

function renderFunnelPanel(container, funnel) {
  clear(container);
  const stages = [
    { label: 'Impressions', value: funnel.impressions, tracked: true },
    { label: 'Engagements', value: funnel.engagements, tracked: true },
    { label: 'Profile views', value: funnel.profile_views.sum, tracked: funnel.profile_views.count > 0 },
    { label: 'Followers gained', value: funnel.followers_gained.sum, tracked: funnel.followers_gained.count > 0 },
    { label: 'Inbound leads', value: funnel.inbound_leads.sum, tracked: funnel.inbound_leads.count > 0 },
  ];
  const base = funnel.impressions || 1;
  for (const stage of stages) {
    const widthPct = stage.tracked ? Math.max(1.5, (stage.value / base) * 100) : 1.5;
    container.appendChild(el('div', { class: 'bar-row' }, [
      el('span', { text: stage.label }),
      el('span', { class: 'bar-track' }, el('span', { class: `bar-fill${stage.tracked ? '' : ' faded'}`, style: `width:${widthPct.toFixed(1)}%` })),
      el('b', { class: 'bar-value', text: stage.tracked ? formatCompact(stage.value) : 'Not tracked' }),
    ]));
  }
}

function renderHealthPanel(container, calloutNode, health) {
  clear(container);
  const rows = [
    ['Profile views', health.profile_views],
    ['Followers gained', health.followers_gained],
    ['Video watch time', health.video_watch_secs],
    ['Inbound leads', health.inbound_leads],
  ];
  for (const [label, stat] of rows) {
    container.appendChild(el('div', { class: 'bar-row' }, [
      el('span', { text: label }),
      el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: `width:${(stat.pct * 100).toFixed(1)}%` })),
      el('b', { class: 'bar-value', text: `${Math.round(stat.pct * 100)}%` }),
    ]));
  }

  if (health.inbound_leads.pct < 0.5) {
    calloutNode.hidden = false;
    calloutNode.textContent = 'Next step: log inbound leads per post, so the dashboard can show which content brings in business.';
  } else {
    calloutNode.hidden = true;
  }
}

export { renderFormatPanel, renderTopicPanel, renderFunnelPanel, renderHealthPanel };
