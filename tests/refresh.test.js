import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRefreshController } from '../js/refresh.js';

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function failedResponse(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

test('loadInitial always fetches posts, regardless of hash', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('data/meta.json')) {
      return jsonResponse({ contentHash: 'abc', generatedAt: '2026-11-17T00:00:00Z' });
    }
    return jsonResponse([{ id: 1 }]);
  };

  const controller = createRefreshController({ fetchImpl });
  const { rawPosts, meta } = await controller.loadInitial();

  assert.deepEqual(rawPosts, [{ id: 1 }]);
  assert.equal(meta.contentHash, 'abc');
  assert.equal(controller.getLastHash(), 'abc');
  assert.equal(calls.length, 2);
});

test('checkNow: unchanged hash makes no posts fetch', async () => {
  let postsFetchCount = 0;
  const fetchImpl = async (url) => {
    if (url.startsWith('data/meta.json')) {
      return jsonResponse({ contentHash: 'same-hash', generatedAt: '2026-11-17T00:00:00Z' });
    }
    postsFetchCount += 1;
    return jsonResponse([]);
  };

  const controller = createRefreshController({ fetchImpl });
  await controller.loadInitial(); // establishes lastHash = 'same-hash', 1 posts fetch so far
  assert.equal(postsFetchCount, 1);

  let upToDateCalled = false;
  let newDataCalled = false;
  const controller2 = createRefreshController({
    fetchImpl,
    onUpToDate: () => { upToDateCalled = true; },
    onNewData: () => { newDataCalled = true; },
  });
  // Seed lastHash the same way loadInitial would, then checkNow should see no change.
  await controller2.loadInitial();
  const postsFetchBefore = postsFetchCount;
  const result = await controller2.checkNow();

  assert.equal(result.changed, false);
  assert.equal(postsFetchCount, postsFetchBefore); // no additional posts fetch
  assert.equal(upToDateCalled, true);
  assert.equal(newDataCalled, false);
});

test('checkNow: changed hash triggers a posts fetch and onNewData', async () => {
  let hash = 'v1';
  let postsFetchCount = 0;
  const fetchImpl = async (url) => {
    if (url.startsWith('data/meta.json')) {
      return jsonResponse({ contentHash: hash, generatedAt: '2026-11-17T00:00:00Z' });
    }
    postsFetchCount += 1;
    return jsonResponse([{ id: 1 }, { id: 2 }]);
  };

  let receivedPosts = null;
  let receivedMeta = null;
  const controller = createRefreshController({
    fetchImpl,
    onNewData: (posts, meta) => { receivedPosts = posts; receivedMeta = meta; },
  });

  await controller.loadInitial();
  const postsFetchAfterInitial = postsFetchCount;

  hash = 'v2'; // sheet changed
  const result = await controller.checkNow();

  assert.equal(result.changed, true);
  assert.equal(postsFetchCount, postsFetchAfterInitial + 1);
  assert.deepEqual(receivedPosts, [{ id: 1 }, { id: 2 }]);
  assert.equal(receivedMeta.contentHash, 'v2');
  assert.equal(controller.getLastHash(), 'v2');
});

test('checkNow: a failed fetch keeps old state and schedules a backoff retry', async () => {
  const fetchImpl = async () => failedResponse(500);

  const scheduledDelays = [];
  let errorCount = 0;
  const controller = createRefreshController({
    fetchImpl,
    onError: () => { errorCount += 1; },
    scheduler: (fn, ms) => { scheduledDelays.push(ms); return 1; },
    clearScheduler: () => {},
  });

  const result = await controller.checkNow();

  assert.ok(result.error);
  assert.equal(errorCount, 1);
  assert.equal(scheduledDelays.length, 1);
  assert.equal(scheduledDelays[0], 60 * 1000); // first backoff step: 1 minute
  assert.equal(controller.getLastHash(), null); // old state untouched
});

test('backoff escalates 1, 2, 4, 8 minutes then holds at 10', async () => {
  const fetchImpl = async () => failedResponse(500);
  const scheduledDelays = [];
  const controller = createRefreshController({
    fetchImpl,
    onError: () => {},
    scheduler: (fn, ms) => { scheduledDelays.push(ms); return 1; },
    clearScheduler: () => {},
  });

  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await controller.checkNow();
  }

  assert.deepEqual(scheduledDelays.map((ms) => ms / 60000), [1, 2, 4, 8, 10, 10]);
});
