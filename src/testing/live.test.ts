/**
 * Browser-only live checks: hit the real server this page is served from.
 * Registered via testBrowser, so the Node runner skips them.
 */
import { assert, testBrowser } from './harness';

testBrowser('live: /api/health отвечает на этом же origin', async () => {
  const res = await fetch('/api/health');
  assert(res.ok, `health вернул HTTP ${res.status}`);
  const body = await res.json();
  assert(body.ok === true, 'health body: ok !== true');
  assert(typeof body.keyConfigured === 'boolean', 'health не сообщает keyConfigured');
});
