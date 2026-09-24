/**
 * Node entry for the isomorphic logic tests: `npm run test:logic`.
 * The same cases also run in the browser at /#tests.
 */
import '../src/testing/chat-store.test';
import { runAll } from '../src/testing/harness';
import { headlessContext } from '../src/testing/fakes';

// Global watchdog: a wedged scenario must fail the run, not hang it.
const timeout = setTimeout(() => {
  console.error('FAIL  logic tests timed out (30s)');
  process.exit(1);
}, 30_000);

const results = await runAll(headlessContext());
clearTimeout(timeout);

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name} (${r.durationMs}ms)`);
  if (!r.ok) {
    failed++;
    console.log(`      ${r.error}`);
  }
}

console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
