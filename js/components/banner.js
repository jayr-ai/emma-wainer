import { el, replaceChildren } from './dom.js';

function periodPhrase(preset, lengthDays) {
  if (preset === 'all') return 'all time';
  if (preset === 'ytd') return 'this year so far';
  if (lengthDays === 30) return 'the last 30 days';
  if (lengthDays === 90) return 'the last 90 days';
  return `the last ${lengthDays} days`;
}

/**
 * Builds the banner sentence as DOM nodes (bold post count, copper-underlined
 * impressions figure) from one of four templates: growth, decline, flat
 * (within +/-5%), and no-comparison.
 *
 * @param {{preset, lengthDays, postsCount, impressions, change}} data
 *   change: { type: 'none' } | { type: 'new' } | { type: 'pct', value }
 */
function bannerSentenceNodes({ preset, lengthDays, postsCount, impressions, change }) {
  if (postsCount === 0) {
    return [`No posts were published in ${periodPhrase(preset, lengthDays)}.`];
  }
  const phrase = periodPhrase(preset, lengthDays);
  const postsText = `${postsCount} post${postsCount === 1 ? '' : 's'}`;
  const impressionsText = `${impressions.toLocaleString('en-US')} impressions`;

  const lead = [
    `In ${phrase}, `,
    el('b', { text: postsText }),
    ' reached ',
    el('span', { class: 'figure' }, el('b', { text: impressionsText })),
  ];

  if (change.type === 'none') {
    lead.push('.');
    return lead;
  }
  if (change.type === 'new') {
    lead.push(', with no prior period to compare to.');
    return lead;
  }

  const pct = Math.round(Math.abs(change.value) * 100);
  if (change.value > 0.05) {
    lead.push(`, ${pct}% more than in the period before.`);
  } else if (change.value < -0.05) {
    lead.push(`, ${pct}% fewer than in the period before.`);
  } else {
    lead.push(', about the same as in the period before.');
  }
  return lead;
}

function renderBanner({ sentenceContainer, bestFormatNode, topPostNode }, data) {
  replaceChildren(sentenceContainer, bannerSentenceNodes(data));

  if (data.bestFormat) {
    bestFormatNode.textContent = `Best format: ${data.bestFormat.key} (${(data.bestFormat.medianRate * 100).toFixed(1)}%)`;
    bestFormatNode.hidden = false;
  } else {
    bestFormatNode.textContent = 'Best format: not enough data yet';
    bestFormatNode.hidden = false;
  }

  if (data.topPost) {
    const truncated = data.topPost.title.length > 60 ? `${data.topPost.title.slice(0, 60)}…` : data.topPost.title;
    topPostNode.textContent = `Top post: ${truncated}`;
    topPostNode.title = data.topPost.title;
    topPostNode.hidden = false;
  } else {
    topPostNode.hidden = true;
  }
}

export { renderBanner, bannerSentenceNodes };
