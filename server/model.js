const ALLOWED_LABELS = new Set(['ai_slop', 'ragebait', 'clickbait', 'generic_advice', 'repetitive', 'low_substance']);
const ALLOWED_CATEGORIES = new Set(['educational', 'gaming', 'technology', 'entertainment', 'news', 'commentary', 'tutorial', 'review', 'documentary', 'music', 'lifestyle', 'other', 'unknown']);
const SYSTEM_PROMPT = `You classify YouTube videos from the supplied title, description, and optional transcript. Return one JSON object with keys: category, labels, topics, formats, evidence, evidenceNote. category must be one of educational, gaming, technology, entertainment, news, commentary, tutorial, review, documentary, music, lifestyle, other, unknown. labels is a list drawn only from ai_slop, ragebait, clickbait, generic_advice, repetitive, low_substance. topics and formats are short plain-language lists. evidence is good when substantial transcript evidence exists, limited when only title/description or sparse transcript exists, insufficient when there is too little usable information. evidenceNote is one concise explanation.

Use multiple labels only when supported. AI-generated content alone is never a quality problem: apply ai_slop only when evidence suggests repetitive mass-produced low-effort content without substance. Apply ragebait only to observable outrage-focused framing/content, never speculate about a creator's motives. Apply clickbait only when available transcript/content materially conflicts with the title; a compelling title alone is not enough. If there is no transcript, do not call a title clickbait. Apply generic_advice only when the video provides vague guidance without meaningful specifics. Use unknown/insufficient evidence rather than guessing. Do not return confidence scores. Do not assess personal relevance; matching is computed separately in the browser.`;
const BATCH_PROMPT = `You screen YouTube homepage recommendation cards using only their visible title, channel, and short description. Return JSON: {"items":[{"id":"same input id","category":"...","labels":[],"topics":[],"formats":[],"evidence":"limited|insufficient","evidenceNote":"..."}]}. Use the established category and label taxonomy: categories educational, gaming, technology, entertainment, news, commentary, tutorial, review, documentary, music, lifestyle, other, unknown; labels ai_slop, ragebait, clickbait, generic_advice, repetitive, low_substance. Return one item for each input, preserving its id. This is title/metadata-only evidence: never label clickbait, do not claim to know video substance, and use insufficient when a pattern cannot be judged from the card. You may label ragebait only when the wording itself uses overt anger/outrage framing; do not guess creator intent. A provocative but ordinary title is not automatically clickbait or ragebait. Generic advice requires visible evidence of vague advice framing, not just a how-to title. AI-generated alone is never a quality issue. No confidence scores. Short note must say that only card text was assessed.`;
function cleanList(value) { return Array.isArray(value) ? [...new Set(value.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 80)))].slice(0, 8) : []; }
function validateAnalysis(value, hasTranscript, provider = 'openai') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model response must be an object.');
  const category = ALLOWED_CATEGORIES.has(value.category) ? value.category : 'unknown';
  const evidence = !hasTranscript ? (value.evidence === 'insufficient' ? 'insufficient' : 'limited') : (['good', 'limited', 'insufficient'].includes(value.evidence) ? value.evidence : 'good');
  let labels = Array.isArray(value.labels) ? [...new Set(value.labels.filter((x) => ALLOWED_LABELS.has(x)))] : [];
  if (!hasTranscript) labels = labels.filter((label) => label !== 'clickbait');
  return { provider, category, labels, topics: cleanList(value.topics), formats: cleanList(value.formats), evidence, evidenceNote: typeof value.evidenceNote === 'string' ? value.evidenceNote.slice(0, 400) : '' };
}
function providerConfig() {
  const provider = process.env.AI_PROVIDER || 'openai';
  if (provider !== 'openai' && provider !== 'ollama') { const e = new Error('AI_PROVIDER must be openai or ollama.'); e.statusCode = 503; e.publicMessage = e.message; throw e; }
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) { const e = new Error('AI analysis is not configured. Set OPENAI_API_KEY or choose local Ollama.'); e.statusCode = 503; e.publicMessage = e.message; throw e; }
  return { provider, model: provider === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen2.5:3b') : (process.env.OPENAI_MODEL || 'gpt-4o-mini') };
}
async function askModel(messages, fetchImpl = fetch) {
  const { provider, model } = providerConfig();
  const local = provider === 'ollama';
  const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const response = await fetchImpl(local ? `${host}/api/chat` : 'https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { ...(local ? {} : { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }), 'Content-Type': 'application/json' },
    body: JSON.stringify(local ? { model, stream: false, format: 'json', messages } : { model, temperature: 0.1, response_format: { type: 'json_object' }, messages })
  });
  if (response.status === 429) { const e = new Error('AI provider rate limit reached. Try again later.'); e.statusCode = 429; e.publicMessage = e.message; throw e; }
  if (!response.ok) { const e = new Error(`AI provider request failed (${response.status}).`); e.publicMessage = e.message; throw e; }
  const payload = await response.json();
  const content = local ? payload.message?.content : payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI provider returned no analysis.');
  try { return { parsed: JSON.parse(content), provider }; } catch { throw new Error('AI provider returned invalid JSON.'); }
}
async function analyzeVideo(video, fetchImpl = fetch) {
  const transcriptText = video.transcript ? `TRANSCRIPT:\n${video.transcript}` : 'TRANSCRIPT: Not available. Do not infer transcript content.';
  const { parsed, provider } = await askModel([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `TITLE: ${video.title}\nCHANNEL: ${video.channel || 'Unknown'}\nDESCRIPTION:\n${video.description || 'Not available'}\n${transcriptText}` }
  ], fetchImpl);
  return validateAnalysis(parsed, Boolean(video.transcript), provider);
}
async function analyzeBatch(videos, fetchImpl = fetch) {
  if (!Array.isArray(videos) || videos.length < 1 || videos.length > 8) { const e = new Error('Submit between 1 and 8 visible recommendation cards.'); e.statusCode = 400; e.publicMessage = e.message; throw e; }
  const safeVideos = videos.map((v, i) => ({ id: String(v.id || i).slice(0, 100), title: String(v.title || '').slice(0, 350), channel: String(v.channel || '').slice(0, 180), description: String(v.description || '').slice(0, 800) }));
  const { parsed, provider } = await askModel([
    { role: 'system', content: BATCH_PROMPT },
    { role: 'user', content: JSON.stringify(safeVideos) }
  ], fetchImpl);
  if (!parsed || !Array.isArray(parsed.items)) throw new Error('AI provider returned an invalid batch result.');
  const byId = new Map(parsed.items.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
  return safeVideos.map((video) => {
    const item = byId.get(video.id);
    if (!item) return { id: video.id, ...validateAnalysis({ category: 'unknown', labels: [], evidence: 'insufficient', evidenceNote: 'The model did not return a result for this card.' }, false, provider) };
    return { id: video.id, ...validateAnalysis(item, false, provider) };
  });
}
module.exports = { analyzeVideo, analyzeBatch, validateAnalysis, ALLOWED_LABELS, SYSTEM_PROMPT, BATCH_PROMPT };

