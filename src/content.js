const CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer';
const queue = [];
const queued = new Set();
const cardsById = new Map();
const placeholders = new WeakMap();
let prefs = { likes: '', avoids: '', excludes: '', avoidClickbait: true, avoidRagebait: true, avoidGeneric: true, filterHome: true };
let processing = false;
let scanTimer;

function isHome() { return location.pathname === '/' || location.pathname === '/feed/recommended'; }
function readCard(card) {
  const titleNode = card.querySelector('#video-title, a[href*="/watch"] yt-formatted-string');
  const title = (titleNode?.textContent || titleNode?.getAttribute('title') || '').trim();
  const link = titleNode?.closest('a[href*="/watch"]') || card.querySelector('a[href*="/watch"]');
  if (!title || !link?.href) return null;
  let url; try { url = new URL(link.href); } catch { return null; }
  const videoId = url.searchParams.get('v') || url.pathname.match(/\/shorts\/([^/?]+)/)?.[1];
  if (!videoId) return null;
  const channel = (card.querySelector('#channel-name, ytd-channel-name')?.textContent || '').trim();
  const description = (card.querySelector('#description-text, #description')?.textContent || '').trim();
  return { id: videoId, title: title.slice(0, 350), channel: channel.slice(0, 180), description: description.slice(0, 800), card };
}
function removeTag(card) { card.querySelector(':scope > .yt-discovery-tag')?.remove(); placeholders.get(card)?.remove(); placeholders.delete(card); card.hidden = false; card.classList.remove('yt-discovery-hidden'); }
function tagCard(card, text, kind, showAnyway = false) {
  removeTag(card);
  const tag = document.createElement('div'); tag.className = 'yt-discovery-tag'; tag.dataset.kind = kind; tag.append(document.createTextNode(text));
  if (showAnyway) {
    const button = document.createElement('button'); button.textContent = 'Show anyway';
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); card.dataset.ydShow = 'true'; card.classList.remove('yt-discovery-hidden'); removeTag(card); });
    tag.append(button);
  }
  card.prepend(tag);
}
function applyResult(card, item, video) {
  if (!document.contains(card)) return;
  card.dataset.ydResult = JSON.stringify(item);
  if (card.dataset.ydShow === 'true') return;
  const decision = YouTubeDiscovery.evaluateHomeCard({ ...item, ...video }, prefs);
  if (decision.hide) {
    removeTag(card);
    const placeholder = document.createElement('div'); placeholder.className = 'yt-discovery-placeholder'; placeholder.append(document.createTextNode(`${video.title} — ${decision.reason.replaceAll('_', ' ')} (card text only)`));
    const button = document.createElement('button'); button.textContent = 'Show this video'; button.addEventListener('click', () => { card.hidden = false; card.classList.remove('yt-discovery-hidden'); card.dataset.ydShow = 'true'; placeholder.remove(); }); placeholder.append(button);
    card.before(placeholder); placeholders.set(card, placeholder); card.hidden = true; card.classList.add('yt-discovery-hidden');
  } else if (item.evidence === 'insufficient' || item.evidence === 'limited') {
    tagCard(card, 'Limited evidence · title/card text only; clickbait cannot be verified without video content.', 'uncertain');
  } else {
    tagCard(card, `Matches your filters${item.topics?.length ? ` · ${item.topics.slice(0, 2).join(', ')}` : ''}`, 'match');
  }
}
async function processQueue() {
  if (processing || !prefs.filterHome || !isHome()) return;
  processing = true;
  let activeBatch = [];
  try {
    while (queue.length && prefs.filterHome && isHome()) {
      const batch = queue.splice(0, 8); activeBatch = batch;
      const endpoint = 'http://127.0.0.1:8787/api/analyze-batch';
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videos: batch.map(({ id, title, channel, description }) => ({ id, title, channel, description })) }) });
      if (!response.ok) throw new Error(`Analysis service returned ${response.status}`);
      const data = await response.json(); const results = new Map((data.items || []).map((item) => [item.id, item]));
      for (const video of batch) {
        queued.delete(video.id);
        const item = results.get(video.id) || { evidence: 'insufficient', labels: [], topics: [], evidenceNote: 'No result for this card.' };
        applyResult(video.card, item, video);
      }
      activeBatch = [];
    }
  } catch (error) {
    for (const video of [...activeBatch, ...queue.splice(0)]) { queued.delete(video.id); tagCard(video.card, 'Could not analyze · check the local AI service', 'uncertain'); }
    console.warn('[YouTube Discovery] Home feed scan failed:', error.message);
  } finally { processing = false; }
}
function scan() {
  if (!prefs.filterHome || !isHome()) return;
  for (const card of document.querySelectorAll(CARD_SELECTOR)) {
    const video = readCard(card);
    if (!video || queued.has(video.id) || cardsById.has(video.id)) continue;
    queued.add(video.id); cardsById.set(video.id, card); queue.push(video);
    tagCard(card, 'Checking this recommendation…', 'uncertain');
  }
  processQueue();
}
function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 900); }
chrome.storage.local.get('preferences').then((saved) => { prefs = { ...prefs, ...(saved.preferences || {}) }; if (isHome() && prefs.filterHome) scheduleScan(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.preferences) return;
  prefs = { ...prefs, ...(changes.preferences.newValue || {}) };
  if (!prefs.filterHome) { queue.length = 0; queued.clear(); }
  for (const [id, card] of cardsById) {
    const video = readCard(card); if (!video) continue;
    if (!prefs.filterHome) { removeTag(card); }
    else { removeTag(card); card.dataset.ydShow = ''; const prior = card.dataset.ydResult; if (prior) applyResult(card, JSON.parse(prior), video); }
  }
  scheduleScan();
});
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('yt-navigate-finish', scheduleScan);
window.addEventListener('popstate', scheduleScan);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_VIDEO_CONTEXT') {
    const videoId = new URL(location.href).searchParams.get('v');
    if (!videoId || !location.pathname.startsWith('/watch')) { sendResponse({ error: 'Open a YouTube video to analyze it. Homepage recommendations are screened automatically.' }); return; }
    const title = document.querySelector('h1 yt-formatted-string')?.textContent?.trim() || document.querySelector('meta[name="title"]')?.content || document.title.replace(/ - YouTube$/, '');
    const description = document.querySelector('#description-inline-expander')?.innerText || document.querySelector('meta[name="description"]')?.content || '';
    const channel = document.querySelector('#channel-name a')?.textContent?.trim() || '';
    const segments = [...document.querySelectorAll('ytd-transcript-segment-renderer .segment-text')].map((node) => node.textContent?.trim()).filter(Boolean);
    sendResponse({ videoId, url: location.href, title: title.slice(0, 500), description: description.slice(0, 6000), channel, transcript: segments.join(' ').slice(0, 18000) });
  }
  if (message?.type === 'GET_FILTER_STATUS') sendResponse({ filtering: prefs.filterHome && isHome(), visibleCards: cardsById.size });
});

