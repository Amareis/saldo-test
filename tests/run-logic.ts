/**
 * Node entry for the isomorphic logic tests: `npm run test:logic`.
 * The same cases also run in the browser at /#tests.
 */
import '../src/testing/chat-store.test';
import { runTests } from '../src/testing/harness';

const results = await runTests();

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
