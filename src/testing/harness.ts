/**
 * Tiny isomorphic test harness — no framework. The same test files run:
 * - in Node via tsx (tests/run-logic.ts), headless and deterministic;
 * - in the browser test panel, interactively: checkpoints pause until
 *   "Далее" is clicked and scenarios drive the visible chat store.
 *
 * Cases register with test(); runners use getTests()/runOne()/runAll().
 */
import type { ChatStore } from '../stores/chat-store';
import type { Role } from '../types/chat';

/** History shape sent to the transport — what goes over the wire. */
export type ApiMessages = { role: Role; content: string }[];

/** What a scripted transport receives — mirrors the real SSE client's options. */
export type ScriptFn = (opts: {
  signal: AbortSignal;
  onDelta: (t: string) => void;
  onReasoning?: (t: string) => void;
}) => void | Promise<void>;

export interface TestContext {
  /**
   * Headless: a fresh ChatStore on the scripted transport.
   * Interactive (browser panel): the VISIBLE singleton, reset and re-wired
   * to the script — the real chat UI renders the scenario live.
   * `captured` collects the history of each transport call for assertions.
   */
  useTransport(script: ScriptFn, captured?: ApiMessages[]): ChatStore;
  /**
   * Headless: no-op. Interactive: pause until "Далее" — put checkpoints
   * inside transport scripts to freeze a stream mid-answer for inspection.
   */
  checkpoint(label?: string): Promise<void>;
}

export interface TestResult {
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export type TestFn = (ctx: TestContext) => void | Promise<void>;

export interface TestCase {
  name: string;
  fn: TestFn;
}

const registry: TestCase[] = [];

export function test(name: string, fn: TestFn): void {
  registry.push({ name, fn });
}

/** Registers only in the browser (e.g. live same-origin API checks). */
export function testBrowser(name: string, fn: TestFn): void {
  if (typeof window !== 'undefined') registry.push({ name, fn });
}

export function getTests(): readonly TestCase[] {
  return registry;
}

export async function runOne({ name, fn }: TestCase, ctx: TestContext): Promise<TestResult> {
  const started = Date.now();
  try {
    await fn(ctx);
    return { name, ok: true, durationMs: Date.now() - started };
  } catch (err) {
    return {
      name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

/** Sequential on purpose: interactive runs drive one shared visible store. */
export async function runAll(ctx: TestContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const entry of registry) results.push(await runOne(entry, ctx));
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
