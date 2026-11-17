// Live refresh: fetching and polling only, no rendering. main.js supplies
// callbacks and does all the DOM work, which is what makes this testable
// with a mocked fetch (see tests/refresh.test.js).

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const HIDDEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_SEQUENCE_MS = [1, 2, 4, 8].map((m) => m * 60 * 1000);
const BACKOFF_STEADY_MS = 10 * 60 * 1000;

function createRefreshController({
  fetchImpl,
  metaUrl = 'data/meta.json',
  postsUrl = 'data/linkedin_posts.json',
  onNewData = () => {},
  onUpToDate = () => {},
  onError = () => {},
  scheduler = (fn, ms) => setTimeout(fn, ms),
  clearScheduler = (id) => clearTimeout(id),
  getHidden = () => (typeof document !== 'undefined' ? document.hidden : false),
}) {
  const fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);

  let lastHash = null;
  let lastSyncedAt = null;
  let pollTimerId = null;
  let retryTimerId = null;
  let retryIndex = 0;
  let hiddenSince = null;
  let checking = false;

  async function fetchMeta() {
    const res = await fetchFn(metaUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`meta fetch failed: ${res.status}`);
    return res.json();
  }

  async function fetchPosts(hash) {
    const res = await fetchFn(`${postsUrl}?v=${hash}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`posts fetch failed: ${res.status}`);
    return res.json();
  }

  function clearRetry() {
    if (retryTimerId !== null) {
      clearScheduler(retryTimerId);
      retryTimerId = null;
    }
    retryIndex = 0;
  }

  function scheduleRetry() {
    const delay = retryIndex < BACKOFF_SEQUENCE_MS.length
      ? BACKOFF_SEQUENCE_MS[retryIndex]
      : BACKOFF_STEADY_MS;
    retryIndex += 1;
    retryTimerId = scheduler(() => checkNow(), delay);
  }

  /** Initial page-load fetch: always loads posts, regardless of hash. */
  async function loadInitial() {
    const meta = await fetchMeta();
    const rawPosts = await fetchPosts(meta.contentHash);
    lastHash = meta.contentHash;
    lastSyncedAt = meta.generatedAt;
    return { rawPosts, meta };
  }

  /** Polling / manual-refresh check: only fetches posts if the hash changed. */
  async function checkNow({ isManual = false } = {}) {
    if (checking) return { skipped: true };
    checking = true;
    try {
      const meta = await fetchMeta();

      if (lastHash === null) {
        const rawPosts = await fetchPosts(meta.contentHash);
        lastHash = meta.contentHash;
        lastSyncedAt = meta.generatedAt;
        clearRetry();
        checking = false;
        onNewData(rawPosts, meta);
        return { changed: true, meta };
      }

      if (meta.contentHash === lastHash) {
        lastSyncedAt = meta.generatedAt;
        clearRetry();
        checking = false;
        onUpToDate({ isManual, meta });
        return { changed: false, meta };
      }

      const rawPosts = await fetchPosts(meta.contentHash);
      lastHash = meta.contentHash;
      lastSyncedAt = meta.generatedAt;
      clearRetry();
      checking = false;
      onNewData(rawPosts, meta);
      return { changed: true, meta };
    } catch (err) {
      checking = false;
      onError(err);
      scheduleRetry();
      return { error: err };
    }
  }

  function pollTick() {
    if (!getHidden()) checkNow();
    pollTimerId = scheduler(pollTick, POLL_INTERVAL_MS);
  }

  function handleVisibilityChange() {
    if (getHidden()) {
      hiddenSince = Date.now();
      return;
    }
    if (hiddenSince !== null && Date.now() - hiddenSince > HIDDEN_REFRESH_THRESHOLD_MS) {
      checkNow();
    }
    hiddenSince = null;
  }

  function start() {
    pollTimerId = scheduler(pollTick, POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  function stop() {
    if (pollTimerId !== null) clearScheduler(pollTimerId);
    clearRetry();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  return {
    loadInitial,
    checkNow,
    start,
    stop,
    getLastSyncedAt: () => lastSyncedAt,
    getLastHash: () => lastHash,
  };
}

export { createRefreshController, POLL_INTERVAL_MS, HIDDEN_REFRESH_THRESHOLD_MS, BACKOFF_SEQUENCE_MS };
