'use strict';

// Source-pinning tests for the apiPatch client helper + ApiError
// surface in app-shell/lib/api.ts. Used by the inline edit-mode
// forms (PR #122 goods, suppliers next) to surface server-side
// validation errors inline.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT, 'app-shell', 'lib', 'api.ts');
const SRC = fs.readFileSync(API_PATH, 'utf8');

// ── ApiError shape ────────────────────────────────────────────────────

test('ApiError is exported and carries status + errors[] + summary message', () => {
  assert.match(SRC, /export class ApiError extends Error/);
  // Constructor captures status + summary + errors.
  assert.match(SRC, /constructor\(status: number, summary: string, errors: string\[\]\)/);
  // Fields are publicly assigned (so the catch site can read err.errors).
  assert.match(SRC, /this\.status = status/);
  assert.match(SRC, /this\.errors = errors/);
  // .name is "ApiError" so instanceof checks AND duck-typing both work.
  assert.match(SRC, /this\.name = 'ApiError'/);
});

// ── apiPatch is exported with the right shape ─────────────────────────

test('apiPatch is an exported async function returning Promise<T>', () => {
  assert.match(SRC, /export async function apiPatch<T>\(path: string, body: unknown\): Promise<T>/);
});

test('apiPatch sends method: PATCH with JSON body + same-origin credentials', () => {
  const fn = SRC.match(/export async function apiPatch[\s\S]*?\n\}/);
  assert.ok(fn, 'apiPatch fn block not located');
  const block = fn[0];
  assert.match(block, /method:\s*'PATCH'/);
  assert.match(block, /credentials:\s*'same-origin'/);
  assert.match(block, /'Content-Type':\s*'application\/json'/);
  assert.match(block, /JSON\.stringify\(body\)/);
});

test('apiPatch routes 401 → AuthError, 4xx → ApiError, 5xx → generic Error', () => {
  const fn = SRC.match(/export async function apiPatch[\s\S]*?\n\}/);
  assert.ok(fn);
  const block = fn[0];
  // 401 throws AuthError (same as apiGet/apiPost).
  assert.match(block, /res\.status === 401[\s\S]*?throw new AuthError/);
  // 4xx range gets a structured-body read and an ApiError throw.
  assert.match(block, /res\.status >= 400 && res\.status < 500/);
  assert.match(block, /throw new ApiError\(res\.status, summary, errors\)/);
  // Non-4xx, non-2xx falls through to a generic Error.
  assert.match(block, /throw new Error\(`API \$\{path\} failed: HTTP \$\{res\.status\}`\)/);
});

test('apiPatch reads the structured error bag without crashing on a non-JSON body', () => {
  const fn = SRC.match(/export async function apiPatch[\s\S]*?\n\}/);
  assert.ok(fn);
  const block = fn[0];
  // try/catch around res.json() so a 4xx with an empty/HTML body still
  // surfaces something useful (the HTTP status in the fallback summary).
  assert.match(block, /try \{ bag = await res\.json\(\); \} catch/);
  // Falls back to the HTTP-status summary if the bag doesn't carry one.
  assert.match(block, /bag\.error \|\| `API \$\{path\} failed: HTTP \$\{res\.status\}`/);
});

test('apiPatch surfaces both bag.error AND bag.errors[] when present', () => {
  // The goods handler returns { error: 'Validation failed', errors: [...] }
  // on 400 — apiPatch must preserve BOTH for the form to render the
  // per-field messages, with `error` as the fallback summary.
  const fn = SRC.match(/export async function apiPatch[\s\S]*?\n\}/);
  assert.ok(fn);
  const block = fn[0];
  assert.match(block, /Array\.isArray\(bag\.errors\) \? bag\.errors\.map\(String\) : \(bag\.error \? \[bag\.error\] : \[\]\)/);
});

// ── Regression guards on the existing helpers ────────────────────────

test('apiGet still throws AuthError on 401 (no regression on PR #?? auth boundary)', () => {
  const fn = SRC.match(/export async function apiGet[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /res\.status === 401[\s\S]*?throw new AuthError/);
});

test('apiPost still throws AuthError on 401 + generic Error on non-2xx', () => {
  const fn = SRC.match(/export async function apiPost[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /res\.status === 401[\s\S]*?throw new AuthError/);
  assert.match(fn[0], /throw new Error\(`API \$\{path\} failed: HTTP \$\{res\.status\}`\)/);
});

test('apiDelete still throws AuthError on 401 (no regression)', () => {
  const fn = SRC.match(/export async function apiDelete[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /res\.status === 401[\s\S]*?throw new AuthError/);
});
