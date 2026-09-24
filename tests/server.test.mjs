/**
 * Server integration tests: spawn the mock OpenRouter + the real proxy
 * (server/index.js) and drive /api/chat over HTTP. Run: npm run test:server.
 *
 * Short watchdogs via env (FIRST_BYTE_TIMEOUT_MS / IDLE_TIMEOUT_MS) keep the
 * suite fast while still exercising the real timeout paths.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let mockProc;
let mockPort;
const servers = [];

/** Spawn a child, resolve when stdout prints "http://localhost:<port>". */
function spawnForPort(command, args, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve({ proc, port: Number(m[1]) });
    });
    proc.on('exit', (code) => reject(new Error(`process exited early (${code}): ${buf}`)));
    setTimeout(() => reject(new Error(`no banner within 5s: ${buf}`)), 5000);
  });
}

async function startServer(mode, extraEnv = {}) {
  const { proc, port } = await spawnForPort('node', ['server/index.js'], {
    PORT: '0',
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_BASE_URL: `http://localhost:${mockPort}/${mode}`,
    FIRST_BYTE_TIMEOUT_MS: '200',
    IDLE_TIMEOUT_MS: '400',
    ...extraEnv,
  });
  servers.push(proc);
  return port;
}

async function chat(port, body = { messages: [{ role: 'user', content: 'hi' }] }, signal) {
  return fetch(`http://localhost:${port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** Read an SSE response into an array of parsed event payloads. */
async function readSse(res) {
  const text = await res.text();
  return text
    .split('\n\n')
    .map((block) => block.trim().match(/^data: (.+)$/m)?.[1])
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

before(async () => {
  ({ proc: mockProc, port: mockPort } = await spawnForPort('node', ['tests/mock-openrouter.mjs'], { MOCK_PORT: '0' }));
});

after(() => {
  mockProc?.kill();
  for (const proc of servers) proc.kill();
});

test('ok: full answer streams and ends with done', async () => {
  const port = await startServer('ok');
  const res = await chat(port);
  assert.equal(res.status, 200);
  const events = await readSse(res);
  const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.equal(text, 'Hello world');
  assert.equal(events.at(-1).type, 'done');
});

test('reasoning: forwarded as separate events; upstream asked for reasoning', async () => {
  const port = await startServer('reasoning');
  const events = await readSse(await chat(port));
  const reasoningText = events.filter((e) => e.type === 'reasoning').map((e) => e.text).join('');
  assert.equal(reasoningText, 'thinking harder');
  assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), 'answer');
  assert.equal(events.at(-1).type, 'done');

  const last = await (await fetch(`http://localhost:${mockPort}/_last`)).json();
  assert.equal(last.reasoning?.enabled, true, 'proxy must request reasoning from OpenRouter');
});

test('slow: stream outliving the first-byte timeout still completes', async () => {
  // Regression: a fetch-attached AbortSignal.timeout used to kill the whole
  // stream at FIRST_BYTE_TIMEOUT_MS. Total here is ~1s with a 200ms cap.
  const port = await startServer('slow');
  const events = await readSse(await chat(port));
  assert.equal(events.filter((e) => e.type === 'delta').length, 8);
  assert.equal(events.at(-1).type, 'done');
});

test('hang: no response headers -> 504 timeout, no eternal spinner', async () => {
  const port = await startServer('hang');
  const started = Date.now();
  const res = await chat(port);
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error.code, 'timeout');
  assert.ok(Date.now() - started < 2000, 'should fail fast, not hang');
});

test('rate_limit: 429 forwarded with retryAfter', async () => {
  const port = await startServer('rate_limit');
  const res = await chat(port);
  assert.equal(res.status, 429);
  const { error } = await res.json();
  assert.equal(error.code, 'rate_limit');
  assert.equal(error.retryAfter, 7);
});

test('cut: socket lost mid-stream -> typed network error, no done', async () => {
  const port = await startServer('cut');
  const events = await readSse(await chat(port));
  assert.equal(events[0].type, 'delta');
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).code, 'network');
  assert.ok(!events.some((e) => e.type === 'done'), 'error must not be followed by done');
});

test('stream_error: upstream in-stream error forwarded, stream ends there', async () => {
  const port = await startServer('stream_error');
  const events = await readSse(await chat(port));
  assert.equal(events[0].type, 'delta');
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).code, 'upstream');
  assert.ok(!events.some((e) => e.type === 'done'));
});

test('bad_request: malformed body -> 400', async () => {
  const port = await startServer('ok');
  const res = await chat(port, { messages: [] });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'bad_request');
});

test('no_key: server without OPENROUTER_API_KEY -> 500 no_key', async () => {
  // Empty string in env beats the .env file (loadEnvFile never overrides).
  const port = await startServer('ok', { OPENROUTER_API_KEY: '' });
  const res = await chat(port);
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error.code, 'no_key');
});

test('client disconnect aborts the upstream stream', async () => {
  const port = await startServer('long');
  const controller = new AbortController();
  const res = await chat(port, undefined, controller.signal);
  assert.equal(res.status, 200);

  // Read one chunk, then walk away.
  const reader = res.body.getReader();
  await reader.read();

  const beforeAbort = (await (await fetch(`http://localhost:${mockPort}/_stats`)).json()).active;
  assert.equal(beforeAbort, 1, 'mock should see one open upstream stream');

  controller.abort();

  const deadline = Date.now() + 3000;
  let active = 1;
  while (Date.now() < deadline) {
    active = (await (await fetch(`http://localhost:${mockPort}/_stats`)).json()).active;
    if (active === 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(active, 0, 'upstream stream should be closed after client abort');
});
