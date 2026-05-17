// Prompt registry — Sprint BG-6.1, Track 6 of backend-grade-plan.md.
//
// Why
// ───
// Until this sprint, every agent handler had its system prompt hard-coded
// as a JS const at the top of the file. Three problems:
//
//   1. Versioning. When we tune a prompt, we lose the old version's
//      behaviour. No A/B, no rollback, no eval against history.
//   2. Reuse. The orchestrator + sourcing + logistics agents share a
//      lot of behavioural guidance (calc-grounding, citation discipline,
//      escalation triggers). Inline copies drift.
//   3. Evaluation. To run a regression eval (Track 6.2) we need to be
//      able to pin which prompt version we're testing.
//
// Design
// ──────
//   - One folder per agent: lib/ai/prompts/<agent>/
//   - One file per version: v1.txt, v2.txt, … (plain text — no JS templating)
//   - Once a version file is committed, it is IMMUTABLE. Tuning a prompt
//     means bumping the version. The eval harness can then test old vs new
//     and the rollout flag can route a % of traffic.
//   - registry.getPrompt(agent, version) returns the content; throws on
//     missing. We deliberately fail loud rather than fall back silently —
//     a missing prompt is a deploy bug, not a runtime bug.
//
// File loading
// ────────────
// Read once on first access, cache forever (process lifetime). Vercel
// function instances are short-lived enough that we don't need to worry
// about hot-reloading. Tests can use clearCache() between cases.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROMPTS_DIR = path.join(__dirname);
const cache = new Map(); // key: `${agent}@${version}` → string

function key(agent, version) {
  return `${agent}@${version}`;
}

function promptPath(agent, version) {
  // Tightly constrain agent + version to prevent path traversal
  // (these are baked-in keys, but defence-in-depth is cheap).
  if (!/^[a-z][a-z0-9_-]{0,40}$/.test(agent)) {
    throw new Error(`promptPath: invalid agent "${agent}"`);
  }
  if (!/^v\d{1,3}$/.test(version)) {
    throw new Error(`promptPath: invalid version "${version}" (expected v<number>)`);
  }
  return path.join(PROMPTS_DIR, agent, `${version}.txt`);
}

function getPrompt(agent, version) {
  const k = key(agent, version);
  if (cache.has(k)) return cache.get(k);
  const file = promptPath(agent, version);
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`getPrompt: cannot read ${agent}@${version} from ${file}: ${err.message}`);
  }
  if (!content || content.trim().length < 50) {
    throw new Error(`getPrompt: ${agent}@${version} is empty or near-empty (deploy bug?)`);
  }
  // Normalise line endings so prompts hash consistently for eval logging.
  content = content.replace(/\r\n/g, '\n');
  cache.set(k, content);
  return content;
}

// List the versions available for an agent. Used by the eval harness to
// "run every shipped version" without hard-coding a list.
function listVersions(agent) {
  if (!/^[a-z][a-z0-9_-]{0,40}$/.test(agent)) return [];
  const dir = path.join(PROMPTS_DIR, agent);
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (_) { return []; }
  return entries
    .filter(f => /^v\d{1,3}\.txt$/.test(f))
    .map(f => f.replace(/\.txt$/, ''))
    .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

// Latest version for an agent. Default selection when callers don't
// pin a version (e.g. the live handlers).
function latestVersion(agent) {
  const versions = listVersions(agent);
  if (!versions.length) {
    throw new Error(`latestVersion: no prompt versions found for "${agent}"`);
  }
  return versions[versions.length - 1];
}

// Convenience: get the latest content in one call.
function getLatest(agent) {
  return getPrompt(agent, latestVersion(agent));
}

// Stable content hash for eval-log correlation. SHA-256, first 12 hex chars.
function hashPrompt(content) {
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  getPrompt,
  getLatest,
  listVersions,
  latestVersion,
  hashPrompt,
  clearCache,
  // Internals exposed for tests
  _promptPath: promptPath,
  PROMPTS_DIR,
};
