import { loadPosts, validatePosts, filterByRange, getDataBounds, parseUtcDate } from './data.js';
import {
  sumField,
  overallEngagementRate,
  medianImpressions,
  medianPerPostEngagementRate,
  changeVsPrevious,
  changeInPoints,
  nullableAggregate,
  dailySeries,
  weeklySeries,
  monthlySeries,
  groupByFormat,
  groupByTopic,
  groupByObjective,
  bestFormat,
  topPostByImpressions,
  medianEngagementRateByMonth,
  postingRhythmGrid,
  funnelMetrics,
  dataHealth,
} from './metrics.js';
import { el, clear } from './components/dom.js';
import { createDateFilter, computeRange, computePreviousRange, parseStateFromUrl } from './components/date-filter.js';
import { renderKpiCard, flashUpdated } from './components/kpi-card.js';
import { renderBanner } from './components/banner.js';
import { renderFormatPanel, renderTopicPanel, renderFunnelPanel, renderHealthPanel } from './components/panels.js';
import { createTopPostsTable } from './components/top-posts-table.js';
import { renderDailyChart } from './charts/daily-bar.js';
import { renderMonthlyChart } from './charts/monthly-line.js';
import { renderRhythmGrid } from './charts/rhythm.js';
import { createRefreshController } from './refresh.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const refs = {
  skeleton: document.getElementById('skeleton'),
  errorState: document.getElementById('error-state'),
  retryButton: document.getElementById('retry-button'),
  main: document.getElementById('main'),
  dateFilterRoot: document.getElementById('date-filter-root'),
  bannerSentence: document.getElementById('banner-sentence'),
  bannerBestFormat: document.getElementById('banner-best-format'),
  bannerTopPost: document.getElementById('banner-top-post'),
  kpiGrid: document.getElementById('kpi-grid'),
  dailyChartToggle: document.getElementById('daily-chart-toggle'),
  dailyChart: document.getElementById('daily-chart'),
  monthlyChart: document.getElementById('monthly-chart'),
  formatPanel: document.getElementById('format-panel'),
  topicPanel: document.getElementById('topic-panel'),
  rhythmPanel: document.getElementById('rhythm-panel'),
  topPostsControls: document.getElementById('top-posts-controls'),
  topPostsTable: document.getElementById('top-posts-table'),
  funnelPanel: document.getElementById('funnel-panel'),
  healthPanel: document.getElementById('health-panel'),
  healthCallout: document.getElementById('health-callout'),
  footerSource: document.getElementById('footer-source'),
  toastRegion: document.getElementById('toast-region'),
};

let allPosts = [];
let bounds = { first: null, last: null };
let dateFilter = null;
let topPostsTable = null;
let groupingOverride = null; // null = automatic, else 'day' | 'week' | 'month'
let lastSyncedAt = null;
let refreshController = null;

function showToast(message) {
  const toast = el('div', { class: 'toast', role: 'status', text: message });
  refs.toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 6000);
}

function dailyNullableSeries(posts, field, from, to) {
  const byDay = new Map();
  for (const p of posts) {
    if (p[field] === null || p[field] === undefined) continue;
    byDay.set(p.date, (byDay.get(p.date) || 0) + p[field]);
  }
  const series = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const key = new Date(t).toISOString().slice(0, 10);
    series.push(byDay.get(key) || 0);
  }
  return series;
}

function autoGrouping(lengthDays) {
  if (lengthDays <= 45) return 'day';
  if (lengthDays <= 200) return 'week';
  return 'month';
}

function pctChangeView(current, previous) {
  const change = changeVsPrevious(current, previous);
  if (change.type === 'new') return { state: 'new' };
  const direction = change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat';
  return { state: 'pct', direction, text: `${Math.abs(Math.round(change.value * 100))}%` };
}

function pointsChangeView(current, previous) {
  const change = changeInPoints(current, previous);
  if (change.type === 'new') return { state: 'new' };
  const direction = change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat';
  return { state: 'points', direction, text: `${Math.abs(change.value * 100).toFixed(1)} pts` };
}

function withCaption(change, captionText) {
  if (!change || change.state === 'new') return change;
  return { ...change, captionText };
}

function renderDailyToggle(current, lengthDays, onChange) {
  clear(refs.dailyChartToggle);
  const options = [
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
  ];
  for (const opt of options) {
    refs.dailyChartToggle.appendChild(el('button', {
      type: 'button',
      'aria-pressed': current === opt.key ? 'true' : 'false',
      text: opt.label,
      onClick: () => onChange(opt.key),
    }));
  }
}

function render() {
  if (allPosts.length === 0) return;
  const state = dateFilter.getState();
  const range = computeRange(state.preset, bounds, state.custom);
  const previousRange = state.compare ? computePreviousRange(state.preset, range.from, range.to) : null;

  const current = filterByRange(allPosts, range.from, range.to);
  const previous = previousRange ? filterByRange(allPosts, previousRange.from, previousRange.to) : [];
  const lengthDays = Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS) + 1;
  const isEmpty = current.length === 0;
  const isAllTime = state.preset === 'all';

  // ---- Footer ----
  const lastDateLabel = bounds.last.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  clear(refs.footerSource);
  refs.footerSource.append(`Source: LinkedIn Blueprint System tracker · Data through ${lastDateLabel}`);
  if (lastSyncedAt) {
    const syncedDate = new Date(lastSyncedAt);
    const hoursAgo = (Date.now() - syncedDate.getTime()) / (60 * 60 * 1000);
    const relative = hoursAgo < 1 ? 'less than an hour ago' : `${Math.round(hoursAgo)} hour${Math.round(hoursAgo) === 1 ? '' : 's'} ago`;
    const syncedSpan = el('span', { title: syncedDate.toISOString() }, ` · Synced ${relative}`);
    refs.footerSource.appendChild(syncedSpan);
    if (hoursAgo > 48) {
      refs.footerSource.appendChild(el('span', { class: 'stale-chip', text: 'Data may be out of date' }));
    }
  }

  // ---- Banner ----
  const impressions = sumField(current, 'impressions');
  const prevImpressions = sumField(previous, 'impressions');
  let bannerChange = { type: 'none' };
  if (isEmpty) {
    bannerChange = { type: 'none' };
  } else if (state.compare && !isAllTime) {
    bannerChange = changeVsPrevious(impressions, prevImpressions);
  }
  renderBanner({
    sentenceContainer: refs.bannerSentence,
    bestFormatNode: refs.bannerBestFormat,
    topPostNode: refs.bannerTopPost,
  }, {
    preset: state.preset,
    lengthDays,
    postsCount: current.length,
    impressions,
    change: bannerChange,
    bestFormat: bestFormat(current, 2),
    topPost: topPostByImpressions(current),
  });

  // ---- KPI cards ----
  const dailyForRange = dailySeries(current, range.from, range.to);
  const impressionsSeries = dailyForRange.map((d) => d.impressions);
  const engagementsSeries = dailyForRange.map((d) => d.engagements);
  const rateSeries = dailyForRange.map((d) => (d.impressions > 0 ? d.engagements / d.impressions : 0));
  const postsSeries = dailyForRange.map((d) => d.posts.length);

  const hasPreviousPeriod = previousRange !== null;
  const captionSuffix = `prior ${lengthDays}d`;

  const engagementRateNow = overallEngagementRate(current);
  const engagementRatePrev = overallEngagementRate(previous);
  const engagementsSum = sumField(current, 'engagements');
  const prevEngagements = sumField(previous, 'engagements');
  const medianImpr = medianImpressions(current);
  const prevMedianImpr = medianImpressions(previous);
  const followers = nullableAggregate(current, 'followers_gained');
  const prevFollowers = nullableAggregate(previous, 'followers_gained');

  function changeFor(kind, currentVal, previousVal) {
    if (isEmpty) return null;
    if (!state.compare) return null;
    if (!hasPreviousPeriod) return { state: 'no-earlier' };
    const base = kind === 'points' ? pointsChangeView(currentVal, previousVal) : pctChangeView(currentVal, previousVal);
    return withCaption(base, kind === 'points'
      ? `vs ${previousVal === null ? '–' : `${(previousVal * 100).toFixed(1)}%`} ${captionSuffix}`
      : `vs ${previousVal.toLocaleString('en-US')} ${captionSuffix}`);
  }

  const cards = [
    renderKpiCard({
      id: 'kpi-impressions', label: 'Impressions',
      valueText: impressions.toLocaleString('en-US'),
      change: changeFor('pct', impressions, prevImpressions),
      sparklineValues: impressionsSeries,
      tooltip: 'Sum of impressions over posts in the selected period.',
    }),
    renderKpiCard({
      id: 'kpi-engagements', label: 'Engagements',
      valueText: engagementsSum.toLocaleString('en-US'),
      change: changeFor('pct', engagementsSum, prevEngagements),
      sparklineValues: engagementsSeries,
      tooltip: 'Sum of engagements over posts in the selected period.',
    }),
    renderKpiCard({
      id: 'kpi-rate', label: 'Engagement rate',
      valueText: engagementRateNow === null ? '–' : `${(engagementRateNow * 100).toFixed(1)}%`,
      change: changeFor('points', engagementRateNow, engagementRatePrev),
      sparklineValues: rateSeries,
      tooltip: 'Total engagements divided by total impressions for the period.',
    }),
    renderKpiCard({
      id: 'kpi-posts', label: 'Posts published',
      valueText: String(current.length),
      change: changeFor('pct', current.length, previous.length),
      sparklineValues: postsSeries,
      tooltip: 'Count of posts published in the selected period.',
    }),
    renderKpiCard({
      id: 'kpi-median-impr', label: 'Median impressions / post',
      valueText: medianImpr === null ? '–' : String(medianImpr),
      change: changeFor('pct', medianImpr, prevMedianImpr),
      sparklineValues: impressionsSeries,
      tooltip: 'Median impressions per post (not the mean), so a few viral posts do not skew the typical result.',
    }),
    renderKpiCard({
      id: 'kpi-followers', label: 'Followers gained',
      valueText: followers.count === 0 ? '–' : followers.sum.toLocaleString('en-US'),
      change: followers.count === 0 ? { state: 'untracked' } : changeFor('pct', followers.sum, prevFollowers.sum),
      sparklineValues: dailyNullableSeries(current, 'followers_gained', range.from, range.to),
      tooltip: `Sum of followers gained, over posts with a logged value (${followers.count} of ${current.length} posts tracked in this period).`,
    }),
  ];
  clear(refs.kpiGrid);
  refs.kpiGrid.append(...cards);

  // ---- Daily / Week / Month chart ----
  const grouping = groupingOverride || autoGrouping(lengthDays);
  renderDailyToggle(grouping, lengthDays, (key) => {
    groupingOverride = key;
    render();
  });
  if (isEmpty) {
    clear(refs.dailyChart);
    refs.dailyChart.appendChild(el('p', { class: 'empty-state', text: 'No posts in this period.' }));
  } else {
    const daily = dailySeries(current, range.from, range.to);
    const points = grouping === 'day' ? daily : grouping === 'week' ? weeklySeries(daily) : monthlySeries(daily);
    renderDailyChart(refs.dailyChart, { points, grouping });
  }

  // ---- Monthly engagement-rate line (full history, always) ----
  const monthlyAll = medianEngagementRateByMonth(allPosts);
  renderMonthlyChart(refs.monthlyChart, {
    points: monthlyAll,
    highlight: { from: range.from.toISOString().slice(0, 7), to: range.to.toISOString().slice(0, 7) },
  });

  // ---- Format / topic+objective / rhythm ----
  if (isEmpty) {
    clear(refs.formatPanel);
    refs.formatPanel.appendChild(el('p', { class: 'empty-state', text: 'No posts in this period.' }));
    clear(refs.topicPanel);
    refs.topicPanel.appendChild(el('p', { class: 'empty-state', text: 'No posts in this period.' }));
  } else {
    const formatGroups = groupByFormat(current)
      .filter((g) => g.count >= 2)
      .sort((a, b) => b.medianRate - a.medianRate);
    renderFormatPanel(refs.formatPanel, formatGroups);
    renderTopicPanel(refs.topicPanel, { topics: groupByTopic(current), objectives: groupByObjective(current) });
  }
  const rhythmGrid = postingRhythmGrid(allPosts, range.to, 6);
  renderRhythmGrid(refs.rhythmPanel, rhythmGrid);

  // ---- Top posts table ----
  topPostsTable.update(current);

  // ---- Funnel / data health ----
  if (isEmpty) {
    clear(refs.funnelPanel);
    refs.funnelPanel.appendChild(el('p', { class: 'empty-state', text: 'No posts in this period.' }));
  } else {
    renderFunnelPanel(refs.funnelPanel, funnelMetrics(current));
  }
  renderHealthPanel(refs.healthPanel, refs.healthCallout, dataHealth(allPosts));
}

function handleNewPosts(rawPosts, meta) {
  const oldIds = new Set(allPosts.map((p) => p.id));
  const validated = validatePosts(rawPosts);
  const newCount = validated.filter((p) => !oldIds.has(p.id)).length;

  allPosts = validated;
  bounds = getDataBounds(allPosts);
  lastSyncedAt = meta.generatedAt;
  dateFilter.setBounds(bounds);
  render();

  for (const id of ['kpi-impressions', 'kpi-engagements', 'kpi-rate', 'kpi-posts', 'kpi-median-impr', 'kpi-followers']) {
    const node = document.getElementById(id);
    if (node) flashUpdated(node);
  }

  const lastDateLabel = bounds.last.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  showToast(newCount > 0
    ? `Updated: ${newCount} new post${newCount === 1 ? '' : 's'}, data through ${lastDateLabel}`
    : `Updated: data through ${lastDateLabel}`);
}

async function boot() {
  refs.retryButton.addEventListener('click', boot);
  refs.errorState.hidden = true;

  try {
    refreshController = createRefreshController({
      metaUrl: 'data/meta.json',
      postsUrl: 'data/linkedin_posts.json',
      onNewData: handleNewPosts,
      onUpToDate: ({ isManual }) => { if (isManual) showToast('Already up to date'); },
      onError: () => {
        showToast("Showing data from before. Couldn't check for updates.");
      },
    });

    const { rawPosts, meta } = await refreshController.loadInitial();
    allPosts = validatePosts(rawPosts);
    bounds = getDataBounds(allPosts);
    lastSyncedAt = meta.generatedAt;

    refs.skeleton.hidden = true;
    refs.main.hidden = false;

    const urlState = parseStateFromUrl(bounds);
    dateFilter = createDateFilter(refs.dateFilterRoot, {
      bounds,
      initialState: urlState,
      onChange: () => render(),
      onRefresh: () => {
        showToast('Checking for new data…');
        refreshController.checkNow({ isManual: true });
      },
    });

    topPostsTable = createTopPostsTable(refs.topPostsControls, refs.topPostsTable);

    render();
    refreshController.start();
  } catch (err) {
    console.error(err);
    refs.skeleton.hidden = true;
    refs.main.hidden = true;
    refs.errorState.hidden = false;
  }
}

boot();
