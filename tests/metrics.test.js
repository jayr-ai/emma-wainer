import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validatePosts, filterByRange, parseUtcDate, getDataBounds, clampDate } from '../js/data.js';
import {
  sumField,
  median,
  overallEngagementRate,
  medianImpressions,
  medianPerPostEngagementRate,
  concentrationShare,
  nullableAggregate,
  dailySeries,
  changeVsPrevious,
} from '../js/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Frozen snapshot, never touched by sync runs — this is what the acceptance
// numbers in the brief are checked against, not the live data file.
const FIXTURE_PATH = join(__dirname, 'fixtures', 'linkedin_posts.snapshot.json');

function loadFixturePosts() {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  return validatePosts(raw); // already filters to series === "Your posts"
}

test('all data (2025-09-01 to 2026-11-13): counts and totals', () => {
  const posts = loadFixturePosts();

  assert.equal(posts.length, 314);
  assert.equal(sumField(posts, 'impressions'), 913553);
  assert.equal(sumField(posts, 'engagements'), 9184);

  const rate = overallEngagementRate(posts);
  assert.equal(Math.round(rate * 10000) / 100, 1.01);
});

test('all data: medians', () => {
  const posts = loadFixturePosts();
  assert.equal(medianImpressions(posts), 339.5);

  const medianRate = medianPerPostEngagementRate(posts);
  assert.equal(Math.round(medianRate * 10000) / 100, 2.11);
});

test('all data: concentration (top 5 / top 10 share of impressions)', () => {
  const posts = loadFixturePosts();
  assert.equal(Math.round(concentrationShare(posts, 5) * 1000) / 10, 60.5);
  assert.equal(Math.round(concentrationShare(posts, 10) * 1000) / 10, 75.3);
});

test('all data: reach distribution', () => {
  const posts = loadFixturePosts();
  assert.equal(posts.filter((p) => p.impressions >= 10000).length, 10);
  assert.equal(posts.filter((p) => p.impressions < 300).length, 141);
});

test('all data: nullable field completeness', () => {
  const posts = loadFixturePosts();

  const pv = nullableAggregate(posts, 'profile_views');
  assert.equal(pv.sum, 837);
  assert.equal(pv.count, 73);

  const fg = nullableAggregate(posts, 'followers_gained');
  assert.equal(fg.sum, 145);
  assert.equal(fg.count, 51);

  const leads = nullableAggregate(posts, 'inbound_leads');
  assert.equal(leads.count, 0);
});

test('last 30 days preset (2026-10-15 to 2026-11-13, anchored to latest date)', () => {
  const posts = loadFixturePosts();
  const { last } = getDataBounds(posts);
  assert.equal(last.toISOString().slice(0, 10), '2026-11-13');

  const from = parseUtcDate('2026-10-15');
  const to = parseUtcDate('2026-11-13');
  const range = filterByRange(posts, from, to);

  assert.equal(range.length, 27);
  assert.equal(sumField(range, 'impressions'), 7561);
  assert.equal(sumField(range, 'engagements'), 328);

  const rate = overallEngagementRate(range);
  assert.equal(Math.round(rate * 10000) / 100, 4.34);
  assert.equal(medianImpressions(range), 206);

  const fg = nullableAggregate(range, 'followers_gained');
  assert.equal(fg.sum, 4);
});

test('previous period (2026-09-15 to 2026-10-14)', () => {
  const posts = loadFixturePosts();
  const from = parseUtcDate('2026-09-15');
  const to = parseUtcDate('2026-10-14');
  const range = filterByRange(posts, from, to);

  assert.equal(range.length, 23);
  assert.equal(sumField(range, 'impressions'), 68981);
  assert.equal(sumField(range, 'engagements'), 614);

  const rate = overallEngagementRate(range);
  assert.equal(Math.round(rate * 10000) / 100, 0.89);
  assert.equal(medianImpressions(range), 312);

  const fg = nullableAggregate(range, 'followers_gained');
  assert.equal(fg.sum, 26);
});

test('empty range returns nulls and no exceptions', () => {
  const posts = loadFixturePosts();
  // A range entirely before the data starts.
  const from = parseUtcDate('2020-01-01');
  const to = parseUtcDate('2020-01-07');
  const range = filterByRange(posts, from, to);

  assert.equal(range.length, 0);
  assert.equal(overallEngagementRate(range), null);
  assert.equal(medianImpressions(range), null);
  assert.equal(medianPerPostEngagementRate(range), null);
  assert.deepEqual(nullableAggregate(range, 'followers_gained'), { sum: 0, count: 0 });
});

test('custom range outside data bounds is clamped', () => {
  const posts = loadFixturePosts();
  const bounds = getDataBounds(posts);

  const tooEarly = parseUtcDate('2000-01-01');
  const tooLate = parseUtcDate('2099-01-01');

  assert.equal(clampDate(tooEarly, bounds).getTime(), bounds.first.getTime());
  assert.equal(clampDate(tooLate, bounds).getTime(), bounds.last.getTime());
});

test('daily series has exactly one entry per calendar day, zero-filled', () => {
  const posts = loadFixturePosts();
  const from = parseUtcDate('2026-11-01');
  const to = parseUtcDate('2026-11-13');
  const range = filterByRange(posts, from, to);

  const series = dailySeries(range, from, to);
  assert.equal(series.length, 13); // Nov 1 .. Nov 13 inclusive

  const dates = series.map((d) => d.date);
  const unique = new Set(dates);
  assert.equal(unique.size, 13);

  // Every day present, including ones with no posts (impressions === 0, not undefined).
  for (const point of series) {
    assert.equal(typeof point.impressions, 'number');
    assert.equal(typeof point.engagements, 'number');
  }
});

test('null fields are not treated as zero', () => {
  const posts = loadFixturePosts();
  const withoutInboundLeads = posts.filter((p) => p.inbound_leads === null);
  assert.equal(withoutInboundLeads.length, posts.length);

  const agg = nullableAggregate(posts, 'inbound_leads');
  assert.equal(agg.sum, 0);
  assert.equal(agg.count, 0); // zero posts with a logged value, not zero leads
});

test('median() handles even and odd counts and empty input', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('changeVsPrevious reports "new" when previous is 0 or null', () => {
  assert.deepEqual(changeVsPrevious(100, 0), { type: 'new' });
  assert.deepEqual(changeVsPrevious(100, null), { type: 'new' });
  const change = changeVsPrevious(150, 100);
  assert.equal(change.type, 'pct');
  assert.equal(change.value, 0.5);
});
