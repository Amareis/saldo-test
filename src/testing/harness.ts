/**
 * Tiny isomorphic test harness — no framework. The same test files run:
 * - in Node via tsx (tests/run-logic.ts), for CI-style checks;
 * - in the browser at /#tests, against the real DOM/timers/fetch.
 *
 * Cases register with test(); a runner calls runTests() and renders/prints.
 */

export interface TestResult {
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

type TestFn = () => void | Promise<void>;

const registry: { name: string; fn: TestFn }[] = [];

export function test(name: string, fn: TestFn): void {
  registry.push({ name, fn });
}

/** Registers only in the browser (e.g. live same-origin API checks). */
export function testBrowser(name: string, fn: TestFn): void {
  if (typeof window !== 'undefined') registry.push({ name, fn });
}

/** Sequential on purpose: cases share the singleton-ish modules they build. */
export async function runTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const { name, fn } of registry) {
    const started = Date.now();
    try {
      await fn();
      results.push({ name, ok: true, durationMs: Date.now() - started });
    } catch (err) {
      results.push({
        name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
    }
  }
  return results;
}

// --- assertions -------------------------------------------------------------

export function assert(cond: unknown, msg = 'assertion failed'): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `expected ${fmt(expected)}, got ${fmt(actual)}`);
  }
}

export function assertIncludes(haystack: string, needle: string, msg?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(msg ?? `expected ${fmt(haystack)} to include ${fmt(needle)}`);
  }
}

function fmt(value: unknown): string {
  const s = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
