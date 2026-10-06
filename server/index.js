const http = require('node:http');
const { analyzeVideo, analyzeBatch } = require('./model');

function loadEnv() {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function createServer() {
  const recent = new Map();
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
    if (req.method === 'GET' && req.url === '/health') { send(res, 200, { ok: true, configured: (process.env.AI_PROVIDER === 'ollama' || Boolean(process.env.OPENAI_API_KEY)) }); return; }
    if (req.method !== 'POST' || !['/api/analyze', '/api/analyze-batch'].includes(req.url)) { send(res, 404, { error: 'Route not found.' }); return; }
    const now = Date.now(); const ip = req.socket.remoteAddress || 'local';
    const calls = (recent.get(ip) || []).filter((time) => now - time < 60_000);
    if (calls.length >= 20) { send(res, 429, { error: 'Local rate limit reached. Wait a minute and try again.' }); return; }
    calls.push(now); recent.set(ip, calls);
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 70_000) { send(res, 413, { error: 'Video details exceed the 70 KB request limit.' }); return; } }
      const input = JSON.parse(raw || '{}');
      if (req.url === '/api/analyze-batch') {
        if (!Array.isArray(input.videos) || input.videos.length < 1 || input.videos.length > 8 || input.videos.some((video) => typeof video.title !== 'string' || !video.title.trim())) {
          send(res, 400, { error: 'Provide 1 to 8 recommendation cards, each with a title.' }); return;
        }
        const items = await analyzeBatch(input.videos);
        send(res, 200, { items }); return;
      }
      if (typeof input.title !== 'string' || !input.title.trim()) { send(res, 400, { error: 'A video title is required.' }); return; }
      const result = await analyzeVideo({ title: input.title.slice(0, 500), description: String(input.description || '').slice(0, 6000), transcript: String(input.transcript || '').slice(0, 18_000), channel: String(input.channel || '').slice(0, 250) });
      send(res, 200, result);
    } catch (error) {
      const status = error.statusCode || 502;
      send(res, status, { error: error.publicMessage || 'Analysis failed. Check the local service configuration and try again.' });
    }
  });
}
if (require.main === module) {
  loadEnv();
  const port = Number(process.env.PORT || 8787);
  createServer().listen(port, '127.0.0.1', () => console.log(`YouTube Discovery analysis service ready at http://127.0.0.1:${port}`));
}
module.exports = { createServer, loadEnv };



