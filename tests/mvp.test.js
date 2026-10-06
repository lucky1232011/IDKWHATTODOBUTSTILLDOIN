const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreVideo, evaluateHomeCard } = require('../src/recommendation');
const { validateAnalysis, analyzeVideo, analyzeBatch } = require('../server/model');
const fs = require('node:fs');
const path = require('node:path');

test('Manifest V3 uses narrow YouTube and localhost permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  assert.ok(manifest.content_scripts[0].matches.every((url) => url.includes('youtube.com')));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  for (const file of [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css, manifest.action.default_popup]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `missing extension resource: ${file}`);
  }
});

test('positive and negative preferences affect transparent match score', () => {
  const input = { title: 'Thoughtful gaming analysis', topics: ['gaming analysis'], labels: [], evidence: 'good' };
  const prefs = { likes: 'gaming analysis', avoids: '' };
  assert.ok(scoreVideo(input, prefs).score > scoreVideo(input, { likes: '', avoids: 'gaming analysis' }).score);
});

test('ordinary-language interest phrases match candidate topics without exact wording', () => {
  const video = { title: 'New truss bridge analysis', topics: ['engineering', 'structural design'], labels: [], evidence: 'limited' };
  const result = scoreVideo(video, { likes: 'I want to watch engineering videos that explain the reasoning' });
  assert.deepEqual(result.positiveMatches, ['I want to watch engineering videos that explain the reasoning']);
});

test('strict exclusions block even a highly relevant video', () => {
  const result = scoreVideo({ title: 'Gaming with crypto sponsorship', topics: ['gaming'], labels: [], evidence: 'good' }, { likes: 'gaming', excludes: 'crypto' });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.strictMatches, ['crypto']);
});

test('homepage filter hides enabled patterns and off-topic cards, but leaves insufficient cards visible', () => {
  const prefs = { filterHome: true, likes: 'engineering', excludes: '', avoidClickbait: true, avoidRagebait: true, avoidGeneric: true };
  const ragebait = evaluateHomeCard({ title: 'Engineering is dead', topics: ['engineering'], labels: ['ragebait'], evidence: 'limited' }, prefs);
  assert.equal(ragebait.hide, true);
  const offTopic = evaluateHomeCard({ title: 'Garden tools', topics: ['gardening'], labels: [], evidence: 'limited' }, prefs);
  assert.equal(offTopic.hide, true);
  const unknown = evaluateHomeCard({ title: 'Unclear recommendation', topics: [], labels: [], evidence: 'insufficient' }, prefs);
  assert.equal(unknown.hide, false);
});

test('classification keeps multiple allowed labels and drops unsupported labels', () => {
  const result = validateAnalysis({ category: 'gaming', labels: ['ragebait', 'clickbait', 'not_a_label'], topics: ['analysis'], evidence: 'good' }, true);
  assert.deepEqual(result.labels, ['ragebait', 'clickbait']);
  assert.equal(result.category, 'gaming');
});

test('clickbait is removed without transcript evidence', () => {
  const result = validateAnalysis({ category: 'unknown', labels: ['clickbait', 'ai_slop'], evidence: 'good' }, false);
  assert.deepEqual(result.labels, ['ai_slop']);
  assert.equal(result.evidence, 'limited');
});

test('missing model credentials fail honestly before network request', async () => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(analyzeVideo({ title: 'Example' }, async () => { throw new Error('must not call'); }), /not configured/);
  if (old !== undefined) process.env.OPENAI_API_KEY = old;
});

test('model API errors and malformed responses surface as failures', async () => {
  process.env.OPENAI_API_KEY = 'test-secret';
  const limited = await analyzeVideo({ title: 'Example' }, async () => ({ status: 429, ok: false } )).catch((error) => error);
  assert.equal(limited.statusCode, 429);
  const malformed = await analyzeVideo({ title: 'Example' }, async () => ({ status: 200, ok: true, json: async () => ({ choices: [{ message: { content: 'no json' } }] }) })).catch((error) => error);
  assert.match(malformed.message, /invalid JSON/);
  delete process.env.OPENAI_API_KEY;
});

test('model key is sent only as authorization header, never in response data', async () => {
  process.env.OPENAI_API_KEY = 'test-secret';
  let sent;
  const result = await analyzeVideo({ title: 'Example', transcript: 'A real transcript.' }, async (_url, init) => {
    sent = init;
    return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ category: 'educational', labels: [], topics: ['science'], formats: ['lecture'], evidence: 'good', evidenceNote: 'Transcript supplied.' }) } }] }) };
  });
  assert.equal(sent.headers.Authorization, 'Bearer test-secret');
  assert.equal(result.topics[0], 'science');
  assert.ok(!JSON.stringify(result).includes('test-secret'));
  delete process.env.OPENAI_API_KEY;
});

test('local service health and missing-key errors are explicit', async (t) => {
  const { createServer } = require('../server/index');
  delete process.env.OPENAI_API_KEY;
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.deepEqual(health, { ok: true, configured: false });
  const missingKey = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Example' }) });
  assert.equal(missingKey.status, 503);
  assert.match((await missingKey.json()).error, /not configured/);
  const invalidBatch = await fetch(`${base}/api/analyze-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videos: [] }) });
  assert.equal(invalidBatch.status, 400);
});

test('Ollama option calls local chat API without a hosted credential', async () => {
  const oldProvider = process.env.AI_PROVIDER;
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.AI_PROVIDER = 'ollama';
  delete process.env.OPENAI_API_KEY;
  let calledUrl; let options;
  try {
    const result = await analyzeVideo({ title: 'Example' }, async (url, init) => {
      calledUrl = url; options = init;
      return { status: 200, ok: true, json: async () => ({ message: { content: JSON.stringify({ category: 'technology', labels: [], topics: ['hardware'], formats: ['review'], evidence: 'limited' }) } }) };
    });
    assert.equal(calledUrl, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(result.provider, 'ollama');
    assert.equal(result.evidence, 'limited');
  } finally {
    if (oldProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = oldProvider;
    if (oldKey !== undefined) process.env.OPENAI_API_KEY = oldKey;
  }
});

test('homepage batch classification preserves IDs and never claims clickbait without transcripts', async () => {
  const oldProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'ollama';
  try {
    const items = await analyzeBatch([{ id: 'v1', title: 'ENGINEERING IS DEAD' }, { id: 'v2', title: 'A bridge design explained' }], async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(init.body);
      assert.match(body.messages[0].content, /homepage recommendation cards/i);
      return { status: 200, ok: true, json: async () => ({ message: { content: JSON.stringify({ items: [
        { id: 'v1', category: 'commentary', labels: ['ragebait', 'clickbait'], topics: ['engineering'], evidence: 'good', evidenceNote: 'Card text only.' },
        { id: 'v2', category: 'educational', labels: [], topics: ['engineering'], evidence: 'good', evidenceNote: 'Card text only.' }
      ] }) } }) };
    });
    assert.deepEqual(items.map((item) => item.id), ['v1', 'v2']);
    assert.deepEqual(items[0].labels, ['ragebait']);
    assert.equal(items[0].evidence, 'limited');
  } finally {
    if (oldProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = oldProvider;
  }
});

