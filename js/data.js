// Loads, validates and filters the raw post data. No aggregation happens
// here — every figure the UI shows is computed from these rows by
// js/metrics.js for the currently selected range.

const REQUIRED_NUMERIC_FIELDS = ['impressions', 'engagements'];
const NULLABLE_NUMERIC_FIELDS = [
  'profile_views',
  'followers_gained',
  'inbound_leads',
  'video_watch_secs',
  'avg_watch_secs',
];

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseUtcDate(dateStr) {
  // Always parse as UTC midnight; never use local time zones for grouping.
  return new Date(`${dateStr}T00:00:00Z`);
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validates one raw row. Returns the cleaned row, or null if it should be
 * skipped (bad date, negative numbers, non-numeric impressions/engagements).
 */
function validateRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (!isValidDateString(row.date)) return null;
  if (!isFiniteNonNegative(row.impressions)) return null;
  if (!isFiniteNonNegative(row.engagements)) return null;

  for (const field of NULLABLE_NUMERIC_FIELDS) {
    const v = row[field];
    if (v !== null && v !== undefined && !isFiniteNonNegative(v)) return null;
  }

  return {
    id: row.id,
    date: row.date,
    dateObj: parseUtcDate(row.date),
    month: row.month,
    title: typeof row.title === 'string' ? row.title : '',
    format: row.format || 'Unlabelled',
    objective: row.objective || 'Unlabelled',
    topic: row.topic || 'Unlabelled',
    kind: row.kind || 'New',
    impressions: row.impressions,
    engagements: row.engagements,
    profile_views: row.profile_views ?? null,
    followers_gained: row.followers_gained ?? null,
    inbound_leads: row.inbound_leads ?? null,
    video_watch_secs: row.video_watch_secs ?? null,
    avg_watch_secs: row.avg_watch_secs ?? null,
    series: row.series,
  };
}

/**
 * Validates the raw array loaded from JSON. Only `series === "Your posts"`
 * rows are kept for the dashboard; benchmark rows are dropped entirely here.
 * Logs a single console warning with the count of skipped rows.
 */
function validatePosts(rawRows) {
  if (!Array.isArray(rawRows)) {
    throw new Error('linkedin_posts.json: expected an array of rows');
  }

  const ownRows = rawRows.filter((r) => r && r.series === 'Your posts');
  const cleaned = [];
  let skipped = 0;

  for (const row of ownRows) {
    const valid = validateRow(row);
    if (valid) {
      cleaned.push(valid);
    } else {
      skipped += 1;
    }
  }

  if (skipped > 0 && typeof console !== 'undefined') {
    console.warn(`linkedin_posts.json: skipped ${skipped} invalid row(s)`);
  }

  cleaned.sort((a, b) => a.dateObj - b.dateObj);
  return cleaned;
}

/** First and last date (as Date objects, UTC midnight) present in the data. */
function getDataBounds(posts) {
  if (posts.length === 0) return { first: null, last: null };
  return { first: posts[0].dateObj, last: posts[posts.length - 1].dateObj };
}

function clampDate(date, bounds) {
  if (date < bounds.first) return bounds.first;
  if (date > bounds.last) return bounds.last;
  return date;
}

/** Inclusive filter by UTC day range. */
function filterByRange(posts, from, to) {
  return posts.filter((p) => p.dateObj >= from && p.dateObj <= to);
}

async function loadPosts(url = 'data/linkedin_posts.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status}`);
  }
  const raw = await res.json();
  return validatePosts(raw);
}

export {
  validateRow,
  validatePosts,
  getDataBounds,
  clampDate,
  filterByRange,
  parseUtcDate,
  loadPosts,
};
