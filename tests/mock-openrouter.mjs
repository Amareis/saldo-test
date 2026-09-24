/**
 * Mock OpenRouter for server integration tests (tests/server.test.mjs).
 * Mode = first path segment: /ok /reasoning /slow /long /hang /rate_limit /cut /stream_error
 *
 *   /ok           — two content chunks, DONE
 *   /reasoning    — reasoning deltas then content, DONE
 *   /slow         — 8 chunks, 120ms apart (total outlives a short first-byte timeout)
 *   /long         — 1000 chunks, 50ms apart (for the client-disconnect test)
 *   /hang         — accepts, never sends headers
 *   /rate_limit   — 429 + Retry-After
 *   /cut          — one chunk, then the socket is destroyed
 *   /stream_error — one chunk, then an in-stream error object
 *
 * Introspection: GET /_stats -> { active }, GET /_last -> last request body.
 */
import http from 'node:http';

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const chunk = (text) => ({ choices: [{ delta: { content: text } }] });
const reasoning = (text) => ({ choices: [{ delta: { reasoning: text } }] });

let active = 0; // open streaming connections — the disconnect test polls this
let lastBody = null;

const server = http.createServer((req, res) => {
  const mode = req.url.split('/')[1] || 'ok';

  if (mode === '_stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ active }));
  }
  if (mode === '_last') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(lastBody ?? 'null');
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastBody = body;

    if (mode === 'rate_limit') {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '7' });
      return res.end(JSON.stringify({ error: { code: 429, message: 'Mock rate limit' } }));
    }
    if (mode === 'hang') return; // headers never arrive

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    active++;
    res.on('close', () => active--); // res, NOT req: req 'close' fires right after the body is consumed

    if (mode === 'ok') {
      sse(res, chunk('Hello'));
      sse(res, chunk(' world'));
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (mode === 'reasoning') {
      sse(res, reasoning('thinking'));
      sse(res, reasoning(' harder'));
      sse(res, chunk('answer'));
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (mode === 'slow' || mode === 'long') {
      const total = mode === 'slow' ? 8 : 1000;
      const interval = mode === 'slow' ? 120 : 50;
      let i = 0;
      const t = setInterval(() => {
        sse(res, chunk(`tick${i} `));
        if (++i === total) {
          clearInterval(t);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }, interval);
      return res.on('close', () => clearInterval(t));
    }
    if (mode === 'cut') {
      sse(res, chunk('partial'));
      return setTimeout(() => res.socket.destroy(), 50);
    }
    if (mode === 'stream_error') {
      sse(res, chunk('partial'));
      sse(res, { error: { code: 503, message: 'Mock mid-stream boom' } });
      return res.end();
    }
    res.end();
  });
});

const PORT = Number(process.env.MOCK_PORT ?? 0);
server.listen(PORT, () => {
  console.log(`[mock] http://localhost:${server.address().port}`);
});
