const DEFAULT_PREFS = { likes: '', avoids: '', excludes: '', avoidClickbait: true, avoidRagebait: true, avoidGeneric: true, filterHome: true, endpoint: 'http://127.0.0.1:8787' };
let currentVideo = null;
let currentAnalysis = null;
let currentScore = null;
const $ = (id) => document.getElementById(id);

async function loadPrefs() {
  const saved = await chrome.storage.local.get('preferences');
  const prefs = { ...DEFAULT_PREFS, ...(saved.preferences || {}) };
  for (const key of ['likes', 'avoids', 'excludes', 'avoidClickbait', 'avoidRagebait', 'avoidGeneric', 'filterHome']) $(key).type === 'checkbox' ? $(`${key}`).checked = !!prefs[key] : $(`${key}`).value = prefs[key];
  return prefs;
}
function readPrefs() {
  return { likes: $('likes').value, avoids: $('avoids').value, excludes: $('excludes').value, avoidClickbait: $('avoidClickbait').checked, avoidRagebait: $('avoidRagebait').checked, avoidGeneric: $('avoidGeneric').checked, filterHome: $('filterHome').checked, endpoint: DEFAULT_PREFS.endpoint };
}
async function savePrefs() {
  const preferences = readPrefs();
  await chrome.storage.local.set({ preferences });
  status('Preferences saved in this browser.');
}
function status(message, error = false) {
  const node = $('status'); node.textContent = message; node.classList.toggle('error', error);
}
async function getVideoContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url?.startsWith('https://www.youtube.com/') && !tab?.url?.startsWith('https://youtube.com/')) throw new Error('Open a YouTube video in the active tab first.');
  $('videoIdentity').textContent = 'Reading video details…';
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_CONTEXT' });
  } catch {
    throw new Error('Refresh the YouTube tab once, then reopen this extension.');
  }
}
function renderResult(analysis, score) {
  $('result').classList.remove('hidden');
  $('matchValue').textContent = `${score.score}/100`;
  $('matchStatus').textContent = score.blocked ? 'STRICTLY EXCLUDED' : score.score >= 65 ? 'GOOD MATCH' : score.score >= 45 ? 'MIXED MATCH' : 'LOW MATCH';
  $('matchStatus').classList.toggle('blocked', score.blocked);
  $('matchExplanation').textContent = score.explanation;
  const labels = [...(analysis.labels || [])];
  if (analysis.category && analysis.category !== 'unknown') labels.unshift(analysis.category);
  $('labels').replaceChildren(...(labels.length ? labels : ['Insufficient information']).map((label) => {
    const chip = document.createElement('span'); chip.className = `chip ${['ragebait', 'clickbait', 'ai_slop', 'generic_advice', 'repetitive', 'low_substance'].includes(label) ? 'warn' : 'good'}`;
    chip.textContent = label.replaceAll('_', ' '); return chip;
  }));
  const evidence = analysis.evidence === 'insufficient' ? 'Not enough information for reliable pattern labels.' : analysis.evidence === 'limited' ? 'Limited evidence: no transcript was available.' : 'Transcript and video details were available.';
  $('evidence').textContent = `${evidence} ${analysis.evidenceNote || ''}`.trim();
}
async function analyze() {
  const button = $('analyze'); button.disabled = true; button.textContent = 'Analyzing…'; $('result').classList.add('hidden');
  try {
    await savePrefs();
    currentVideo = await getVideoContext();
    if (currentVideo.error) throw new Error(currentVideo.error);
    if (!currentVideo.title) throw new Error('Could not read the video title.');
    $('videoIdentity').textContent = `${currentVideo.title}${currentVideo.channel ? ` · ${currentVideo.channel}` : ''}`;
    status('Classifying available video details…');
    const endpoint = DEFAULT_PREFS.endpoint.replace(/\/$/, '');
    const response = await fetch(`${endpoint}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: currentVideo.title, description: currentVideo.description, transcript: currentVideo.transcript, channel: currentVideo.channel })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Analysis service returned ${response.status}.`);
    currentAnalysis = payload;
    const prefs = readPrefs();
    currentScore = YouTubeDiscovery.scoreVideo({ ...payload, ...currentVideo }, prefs);
    renderResult(payload, currentScore);
    status(payload.provider === 'openai' ? 'AI analysis complete. Match score uses your local preferences.' : 'Analysis complete.');
  } catch (error) {
    status(`${error.message} Check that the local service and Ollama are running.`, true);
  } finally {
    button.disabled = false; button.innerHTML = 'Analyze this video <span aria-hidden="true">↗</span>';
  }
}
async function feedback(kind) {
  if (!currentAnalysis) return;
  const prefs = readPrefs();
  const topics = (currentAnalysis.topics || []).slice(0, 2);
  if (!topics.length) { status('No clear topic to learn from. Edit your preferences directly.', true); return; }
  const key = kind === 'relevant' ? 'likes' : 'avoids';
  const values = YouTubeDiscovery.split(prefs[key]);
  for (const topic of topics) if (!values.some((item) => item.toLowerCase() === topic.toLowerCase())) values.push(topic);
  prefs[key] = values.join(', ');
  $('likes').value = prefs.likes; $('avoids').value = prefs.avoids;
  await chrome.storage.local.set({ preferences: prefs, lastFeedback: { videoId: currentVideo.videoId, kind, topics, at: Date.now() } });
  status(`Saved ${kind === 'relevant' ? 'as interests' : 'to down-rank'}: ${topics.join(', ')}. You can edit this above.`);
}
$('savePrefs').addEventListener('click', savePrefs);
$('analyze').addEventListener('click', analyze);
document.querySelectorAll('[data-feedback]').forEach((button) => button.addEventListener('click', () => feedback(button.dataset.feedback)));
loadPrefs().catch(() => status('Could not load preferences from browser storage.', true));
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      if (url.hostname.endsWith('youtube.com') && ['/', '/feed/recommended'].includes(url.pathname)) {
        $('videoIdentity').textContent = 'YouTube homepage · visible recommendations are screened automatically.';
        $('analyze').classList.add('hidden');
        status('Refresh YouTube if you just enabled the homepage filter.');
        return;
      }
    }
    const video = await getVideoContext();
    if (video?.title) { currentVideo = video; $('videoIdentity').textContent = `${video.title}${video.channel ? ` · ${video.channel}` : ''}`; }
  } catch { /* Empty state already explains what the user should open. */ }
})();


