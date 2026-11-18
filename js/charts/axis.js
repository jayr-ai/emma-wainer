// Shared helpers for building simple hand-rolled SVG charts.

function formatCompact(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** Picks a "nice" step (1/2/5 * 10^k) so about `targetCount` ticks fit under max. */
function niceStep(max, targetCount = 4) {
  if (max <= 0) return 1;
  const rough = max / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  let step;
  if (residual >= 5) step = 10 * magnitude;
  else if (residual >= 2) step = 5 * magnitude;
  else if (residual >= 1) step = 2 * magnitude;
  else step = magnitude;
  return step;
}

/** Tick values from 0 up to (at least) max, using a nice step. */
function niceTicks(max, targetCount = 4) {
  if (max <= 0) return [0];
  const step = niceStep(max, targetCount);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  // The loop above stops as soon as a tick passes max, which can leave the
  // last tick just short of it (e.g. max 5.77 with a step of 2 stops at 4).
  // Callers use the last tick as the axis ceiling, so a value sitting in
  // that gap would plot above the chart and get clipped — always make sure
  // the ticks actually cover max.
  if (ticks[ticks.length - 1] < max) {
    ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100);
  }
  return ticks;
}

export { formatCompact, niceStep, niceTicks };
