// Pure metric functions over arrays of validated post rows (see js/data.js).
// Nothing here touches the DOM or fetch — every function takes data in and
// returns numbers/arrays out, so it can be unit tested directly.
//
// Rates/shares are returned as fractions (0..1), not pre-multiplied by 100
// and not pre-rounded. Formatting (rounding, "%", arrows, "New") belongs to
// the UI layer, not here.

const DAY_MS = 24 * 60 * 60 * 1000;

function sumField(posts, field) {
  return posts.reduce((acc, p) => acc + p[field], 0);
}

/** Standard median: average of the two middle values for an even count. */
function median(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Total engagements / total impressions. Null if impressions sum is 0. */
function overallEngagementRate(posts) {
  const impressions = sumField(posts, 'impressions');
  if (impressions === 0) return null;
  const engagements = sumField(posts, 'engagements');
  return engagements / impressions;
}

/** Per-post engagement rate. Null if the post has 0 impressions. */
function perPostEngagementRate(post) {
  if (!post.impressions || post.impressions <= 0) return null;
  return post.engagements / post.impressions;
}

function medianImpressions(posts) {
  return median(posts.map((p) => p.impressions));
}

/** Median of per-post engagement rate, over posts with impressions > 0. */
function medianPerPostEngagementRate(posts) {
  const rates = posts
    .filter((p) => p.impressions > 0)
    .map((p) => p.engagements / p.impressions);
  return median(rates);
}

/**
 * Change vs. previous period, as a rounded-free fraction.
 * Returns { type: 'new' } if previous is 0, null or undefined.
 * Returns { type: 'pct', value } where value = (current - previous) / previous.
 */
function changeVsPrevious(current, previous) {
  if (previous === null || previous === undefined || previous === 0) {
    return { type: 'new' };
  }
  return { type: 'pct', value: (current - previous) / previous };
}

/**
 * Change in percentage points for a rate-like metric (e.g. engagement rate).
 * Returns { type: 'new' } if previous is null/undefined (no prior rate to compare).
 * Returns { type: 'points', value } where value = current - previous (fraction difference).
 */
function changeInPoints(current, previous) {
  if (previous === null || previous === undefined) {
    return { type: 'new' };
  }
  return { type: 'points', value: current - previous };
}

/** Share of total impressions delivered by the top N posts (by impressions). */
function concentrationShare(posts, n) {
  const impressions = sumField(posts, 'impressions');
  if (impressions === 0) return 0;
  const top = [...posts]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, n);
  return sumField(top, 'impressions') / impressions;
}

/** Sum and count of non-null values for a nullable field. */
function nullableAggregate(posts, field) {
  const withValue = posts.filter((p) => p[field] !== null && p[field] !== undefined);
  return {
    sum: sumField(withValue, field),
    count: withValue.length,
  };
}

function toDayKey(dateObj) {
  return dateObj.toISOString().slice(0, 10);
}

/**
 * One point per calendar day in [from, to] inclusive (UTC), zero-filled
 * where there was no post that day.
 */
function dailySeries(posts, from, to) {
  const byDay = new Map();
  for (const p of posts) {
    const key = p.date;
    const entry = byDay.get(key) || { impressions: 0, engagements: 0, posts: [] };
    entry.impressions += p.impressions;
    entry.engagements += p.engagements;
    entry.posts.push(p);
    byDay.set(key, entry);
  }

  const series = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const key = toDayKey(d);
    const entry = byDay.get(key);
    series.push({
      date: key,
      impressions: entry ? entry.impressions : 0,
      engagements: entry ? entry.engagements : 0,
      posts: entry ? entry.posts : [],
    });
  }
  return series;
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
function isoWeekday(dateObj) {
  return ((dateObj.getUTCDay() + 6) % 7) + 1;
}

/** Monday (UTC midnight) of the ISO week containing dateObj. */
function isoWeekStart(dateObj) {
  const offset = isoWeekday(dateObj) - 1;
  return new Date(dateObj.getTime() - offset * DAY_MS);
}

/** Aggregates a daily series (see dailySeries) into ISO-week (Mon-start) buckets. */
function weeklySeries(daily) {
  const buckets = new Map();
  for (const point of daily) {
    const d = new Date(`${point.date}T00:00:00Z`);
    const weekStart = toDayKey(isoWeekStart(d));
    const entry = buckets.get(weekStart) || { date: weekStart, impressions: 0, engagements: 0 };
    entry.impressions += point.impressions;
    entry.engagements += point.engagements;
    buckets.set(weekStart, entry);
  }
  return [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Aggregates a daily series into calendar-month buckets. */
function monthlySeries(daily) {
  const buckets = new Map();
  for (const point of daily) {
    const key = point.date.slice(0, 7); // YYYY-MM
    const entry = buckets.get(key) || { date: key, impressions: 0, engagements: 0 };
    entry.impressions += point.impressions;
    entry.engagements += point.engagements;
    buckets.set(key, entry);
  }
  return [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Groups posts by a key function, returning per-group count, median
 * impressions and median per-post engagement rate. Order is not sorted
 * here — callers sort as their panel requires.
 */
function groupMedianBy(posts, keyFn) {
  const groups = new Map();
  for (const p of posts) {
    const key = keyFn(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const result = [];
  for (const [key, groupPosts] of groups) {
    result.push({
      key,
      count: groupPosts.length,
      medianImpressions: medianImpressions(groupPosts),
      medianRate: medianPerPostEngagementRate(groupPosts),
    });
  }
  return result;
}

function groupByFormat(posts) {
  return groupMedianBy(posts, (p) => p.format);
}

function groupByTopic(posts) {
  return groupMedianBy(posts, (p) => p.topic);
}

function groupByObjective(posts) {
  return groupMedianBy(posts, (p) => p.objective);
}

/** Highest median per-post engagement rate among formats with >= minCount posts. */
function bestFormat(posts, minCount = 2) {
  const groups = groupByFormat(posts).filter((g) => g.count >= minCount && g.medianRate !== null);
  if (groups.length === 0) return null;
  groups.sort((a, b) => b.medianRate - a.medianRate);
  return groups[0];
}

function topPostByImpressions(posts) {
  if (posts.length === 0) return null;
  return [...posts].sort((a, b) => b.impressions - a.impressions)[0];
}

/**
 * Sorts posts for the "Top posts" table.
 * by: 'impressions' (default) or 'rate'.
 * For 'rate', only posts with impressions >= minImpressionsForRate are eligible.
 */
function sortTopPosts(posts, { by = 'impressions', minImpressionsForRate = 200 } = {}) {
  if (by === 'rate') {
    return posts
      .filter((p) => p.impressions >= minImpressionsForRate)
      .sort((a, b) => perPostEngagementRate(b) - perPostEngagementRate(a));
  }
  return [...posts].sort((a, b) => b.impressions - a.impressions);
}

/** Median per-post engagement rate by calendar month, over ALL posts (full history). */
function medianEngagementRateByMonth(allPosts) {
  const byMonth = new Map();
  for (const p of allPosts) {
    const key = p.month || p.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(p);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, groupPosts]) => ({
      month,
      medianRate: medianPerPostEngagementRate(groupPosts),
    }));
}

/**
 * Last `weeks` ISO weeks (Mon-Fri only) ending on or before `endDate`.
 * Returns an array of weeks, each an array of 5 cells {date, impressions}
 * (impressions is 0, not null, for days with no post).
 */
function postingRhythmGrid(posts, endDate, weeks = 6) {
  const byDay = new Map();
  for (const p of posts) {
    byDay.set(p.date, (byDay.get(p.date) || 0) + p.impressions);
  }

  const lastWeekStart = isoWeekStart(endDate);
  const grid = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const weekStart = new Date(lastWeekStart.getTime() - w * 7 * DAY_MS);
    const week = [];
    for (let d = 0; d < 5; d += 1) {
      const day = new Date(weekStart.getTime() + d * DAY_MS);
      const key = toDayKey(day);
      week.push({ date: key, impressions: byDay.get(key) || 0 });
    }
    grid.push(week);
  }
  return grid;
}

/** Impressions -> engagements -> profile views -> followers gained -> inbound leads. */
function funnelMetrics(posts) {
  return {
    impressions: sumField(posts, 'impressions'),
    engagements: sumField(posts, 'engagements'),
    profile_views: nullableAggregate(posts, 'profile_views'),
    followers_gained: nullableAggregate(posts, 'followers_gained'),
    inbound_leads: nullableAggregate(posts, 'inbound_leads'),
  };
}

/**
 * Completeness of nullable fields across ALL data (not the selected range).
 * video_watch_secs completeness is measured among video posts only.
 */
function dataHealth(allPosts) {
  const videoPosts = allPosts.filter((p) => p.format.startsWith('Video'));
  const pct = (count, total) => (total === 0 ? 0 : count / total);

  const pv = nullableAggregate(allPosts, 'profile_views');
  const fg = nullableAggregate(allPosts, 'followers_gained');
  const vw = nullableAggregate(videoPosts, 'video_watch_secs');
  const il = nullableAggregate(allPosts, 'inbound_leads');

  return {
    profile_views: { count: pv.count, total: allPosts.length, pct: pct(pv.count, allPosts.length) },
    followers_gained: { count: fg.count, total: allPosts.length, pct: pct(fg.count, allPosts.length) },
    video_watch_secs: { count: vw.count, total: videoPosts.length, pct: pct(vw.count, videoPosts.length) },
    inbound_leads: { count: il.count, total: allPosts.length, pct: pct(il.count, allPosts.length) },
  };
}

export {
  sumField,
  median,
  overallEngagementRate,
  perPostEngagementRate,
  medianImpressions,
  medianPerPostEngagementRate,
  changeVsPrevious,
  changeInPoints,
  concentrationShare,
  nullableAggregate,
  dailySeries,
  isoWeekday,
  isoWeekStart,
  weeklySeries,
  monthlySeries,
  groupMedianBy,
  groupByFormat,
  groupByTopic,
  groupByObjective,
  bestFormat,
  topPostByImpressions,
  sortTopPosts,
  medianEngagementRateByMonth,
  postingRhythmGrid,
  funnelMetrics,
  dataHealth,
};
