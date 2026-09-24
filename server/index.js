/**
 * Minimal OpenRouter proxy server.
 *
 * Why it exists: the OpenRouter API key must never reach the browser —
 * not in the JS bundle, not in requests from the page. The browser only
 * talks to /api/chat on this server; the server attaches the key and
 * streams the model's answer back as Server-Sent Events.
 *
 * Zero config beyond .env, see .env.example.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// --- config ---------------------------------------------------------------

loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT ?? 8787);
const API_KEY = process.env.OPENROUTER_API_KEY ?? '';
// Any ":free" model from https://openrouter.ai/models works; override in .env.
// Picked from the live free pool — free slugs rotate, so check the catalog if 404.
const MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free';
// Overridable so the proxy can be integration-tested against a local mock
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

// Free models (especially reasoning ones like Nemotron) routinely stall:
// queued at the provider, "thinking" without emitting. Timeouts must
// tolerate that — 20s/30s here caused regular mid-chat drops.
// NB: there is deliberately NO total-time cap — long reasoning answers
// are fine as long as tokens keep flowing; only silence is suspicious.
const FIRST_BYTE_TIMEOUT_MS = Number(process.env.FIRST_BYTE_TIMEOUT_MS ?? 60_000); // waiting for response headers
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS ?? 90_000); // silence in the middle of a stream

/** Tiny .env parser so we don't need dotenv (KEY=value, # comments, optional quotes). */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// --- app ------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: MODEL, keyConfigured: Boolean(API_KEY) });
});

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    return sendHttpError(res, 500, 'no_key', 'Server is missing OPENROUTER_API_KEY. Copy .env.example to .env and add your key.');
  }

  const messages = sanitizeMessages(req.body?.messages);
  if (!messages) {
    return sendHttpError(res, 400, 'bad_request', 'Body must be { messages: [{ role: "user"|"assistant", content: string }] }.');
  }
  log(`[chat] -> ${MODEL}, messages=${messages.length}`);

  const upstream = new AbortController();
  // If the browser tab disconnects (Stop button, closed tab) — stop paying for tokens.
  // NB: listening to res, not req: in Node, req emits 'close' as soon as the
  // request body is fully consumed, which would abort the upstream call instantly.
  res.on('close', () => {
    if (!res.writableEnded) {
      log('[chat] client disconnected, aborting upstream');
      upstream.abort(new Error('client disconnected'));
    }
  });

  // First-byte watchdog: covers ONLY the wait for response headers, then
  // is cancelled. NB: not AbortSignal.timeout() — a fetch signal stays
  // attached for the whole body stream, so a fixed timeout killed long
  // reasoning answers mid-stream (observed: TimeoutError exactly 60s after
  // request start, with tokens flowing).
  const firstByte = new AbortController();
  const firstByteTimer = setTimeout(
    () => firstByte.abort(new Error(`no response headers within ${FIRST_BYTE_TIMEOUT_MS / 1000}s`)),
    FIRST_BYTE_TIMEOUT_MS,
  );

  let upstreamRes;
  try {
    upstreamRes = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.any([upstream.signal, firstByte.signal]),
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        // OpenRouter ranking metadata, optional but polite
        'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:8787',
        'X-Title': process.env.APP_NAME ?? 'saldo-test chat',
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: true,
        // Ask for reasoning tokens: without this, reasoning models "think"
        // in total silence and the stream looks dead (idle watchdog fires).
        reasoning: { enabled: true },
      }),
    });
  } catch (err) {
    clearTimeout(firstByteTimer);
    if (upstream.signal.aborted) {
      // Client went away while we were waiting — the socket is already
      // closed, nothing to write an error to.
      log('[chat] client disconnected while waiting for the model');
      return;
    }
    if (firstByte.signal.aborted) {
      log(`[chat] first-byte timeout (${FIRST_BYTE_TIMEOUT_MS / 1000}s waiting for headers)`);
      return sendHttpError(res, 504, 'timeout', 'The model did not start answering in time.');
    }
    log(`[chat] upstream call failed: ${err?.name ?? err}`);
    return sendHttpError(res, 502, 'network', 'Could not reach OpenRouter.');
  }
  clearTimeout(firstByteTimer);

  // Setup-phase errors: forward a real HTTP status before any streaming starts,
  // so the client can rely on response.ok.
  if (!upstreamRes.ok || !upstreamRes.body) {
    const { code, message, retryAfter } = await readUpstreamError(upstreamRes);
    log(`[chat] upstream HTTP ${upstreamRes.status} (body code=${code ?? 'n/a'}): ${message}`);
    const isRateLimit = upstreamRes.status === 429 || code === 429;
    if (isRateLimit) return sendHttpError(res, 429, 'rate_limit', message, retryAfter);
    if (upstreamRes.status === 401 || upstreamRes.status === 403) return sendHttpError(res, 502, 'auth', message);
    if (upstreamRes.status === 408 || upstreamRes.status === 504) return sendHttpError(res, 504, 'timeout', message);
    return sendHttpError(res, 502, 'upstream', message);
  }
  log('[chat] upstream streaming');

  // --- streaming phase ------------------------------------------------------
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let proxies buffer SSE
  });

  // Watchdog: if the stream goes silent mid-answer, fail loudly instead of
  // leaving the user with an eternal spinner.
  let idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
  function onIdleTimeout() {
    log(`[chat] idle timeout (${IDLE_TIMEOUT_MS / 1000}s of silence)`);
    upstream.abort(new Error('stream idle timeout'));
    sendSse(res, { type: 'error', code: 'timeout', message: 'The model stopped responding mid-answer.' });
    res.end();
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let streamFailed = false;
  let totalChars = 0;
  try {
    for await (const chunk of upstreamRes.body) {
      if (res.writableEnded || streamFailed) break;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);

      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue; // incomplete/keep-alive payloads — skip
        }
        // OpenRouter can send an error object inside the stream itself —
        // forward it and end: an error followed by "done" is nonsense.
        if (json.error) {
          log(`[chat] in-stream error: ${json.error?.code ?? ''} ${json.error?.message ?? ''}`);
          sendSse(res, normalizeStreamError(json.error));
          streamFailed = true;
          break;
        }
        const delta = json.choices?.[0]?.delta;
        const text = delta?.content;
        if (text) {
          totalChars += text.length;
          sendSse(res, { type: 'delta', text });
        }
        // Reasoning tokens travel separately from content — forward them too.
        const reasoning =
          delta?.reasoning ??
          (Array.isArray(delta?.reasoning_details)
            ? delta.reasoning_details.map((r) => r?.text ?? '').filter(Boolean).join('')
            : '');
        if (reasoning) sendSse(res, { type: 'reasoning', text: reasoning });
      }
    }
    if (!res.writableEnded) {
      if (!streamFailed) {
        log(`[chat] done, ${totalChars} chars`);
        sendSse(res, { type: 'done', model: MODEL });
      }
      res.end();
    }
  } catch (err) {
    if (!res.writableEnded) {
      const abortedByClient = upstream.signal.aborted && String(upstream.signal.reason).includes('client');
      if (!abortedByClient) {
        log(`[chat] upstream connection lost mid-answer: ${err?.name ?? err}`);
        sendSse(res, { type: 'error', code: 'network', message: 'The connection to the model was lost mid-answer.' });
      }
      res.end();
    }
  } finally {
    clearTimeout(idleTimer);
  }
});

// --- helpers ---------------------------------------------------------------

function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) return null;
  const out = [];
  for (const m of input) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m?.content !== 'string') return null;
    const content = m.content.slice(0, 8000); // hard cap, no reason for a chat msg to be a novel
    if (m.role === 'user' && !content.trim()) return null;
    out.push({ role: m.role, content });
  }
  if (!out.some((m) => m.role === 'user')) return null;
  // A "stopped"/partial assistant message must not end the history — models
  // expect the last turn to be the user's.
  while (out.length && out[out.length - 1].role === 'assistant') out.pop();
  return out.length ? out : null;
}

async function readUpstreamError(upstreamRes) {
  const retryAfterHeader = upstreamRes.headers.get('retry-after');
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  let code;
  let message = `OpenRouter responded with HTTP ${upstreamRes.status}.`;
  try {
    const body = await upstreamRes.json();
    if (body?.error?.message) message = body.error.message;
    // OpenRouter sometimes reports the real status inside the body
    // (e.g. a provider-side 429 arrives with a generic HTTP status)
    if (Number.isFinite(body?.error?.code)) code = body.error.code;
  } catch {
    /* body wasn't JSON — keep the generic message */
  }
  return { code, message, retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined };
}

function normalizeStreamError(error) {
  const code = error?.code === 429 ? 'rate_limit' : 'upstream';
  return { type: 'error', code, message: error?.message ?? 'The model returned an error mid-stream.' };
}

function sendHttpError(res, status, code, message, retryAfter) {
  res.status(status).json({ error: { code, message, retryAfter } });
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** One log line per event — silent failures are how "connection dropped" mysteries happen. */
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// --- static frontend (production build) ------------------------------------

const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (model: ${MODEL}, key ${API_KEY ? 'configured' : 'MISSING — see .env.example'})`);
});
