'use strict';

// Denied-party / sanctions pre-screen (Sprint sanctions-screen-v1).
//
// Deterministic name-matching engine: normalise → token-sort → score a query
// counterparty name against a list of designated parties (exact, fuzzy, and
// alias-aware). No LLM — the AI layer only narrates the result.
//
// SAFE-BY-DESIGN. The screen NEVER returns "clear". A query with no hit returns
// status 'no_sample_match' plus a mandatory advisory that the caller must still
// screen against the official consolidated lists. The only definitive output it
// produces is a POTENTIAL match to escalate — it can flag, it can never absolve.
//
// The list is injectable (`screen({ name, list })`) so the same engine runs
// against the illustrative sample today and the real EU/UK/OFAC/UN consolidated
// lists once ingestion lands. Default list is the illustrative sample.

const SAMPLE = require('./data/sanctions-sample');

const DEFAULT_THRESHOLD = 0.85;

// Corporate / vessel form words stripped before matching so "Acme Ltd",
// "Acme LLC", and "Acme" collapse to the same key.
const FORM_WORDS = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'co', 'company', 'corp',
  'corporation', 'gmbh', 'plc', 'oao', 'ooo', 'pjsc', 'ojsc', 'sa', 'sas',
  'ag', 'bv', 'nv', 'srl', 'spa', 'as', 'oy', 'ab', 'kg', 'mv', 'ms', 'the',
]);

// Normalise a name to a token-sorted key: lowercase, strip diacritics +
// punctuation, drop form words, sort tokens (so "Petrov, Ivan" === "Ivan
// Petrov"). Returns '' for empty/no-signal input.
function normalizeName(value) {
  const tokens = String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !FORM_WORDS.has(t));
  return tokens.sort().join(' ');
}

// Levenshtein distance (iterative, two-row) — bounded inputs (names), so the
// O(n·m) cost is negligible.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// Similarity in [0,1] between two already-normalised keys: the max of token
// Jaccard (handles word add/drop) and character Levenshtein ratio (handles
// typos). Exact equality short-circuits to 1.
function similarity(an, bn) {
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  const at = new Set(an.split(' '));
  const bt = new Set(bn.split(' '));
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter += 1;
  const jaccard = inter / (at.size + bt.size - inter);
  const lev = 1 - levenshtein(an, bn) / Math.max(an.length, bn.length);
  return Math.max(jaccard, lev);
}

// Best similarity of the query against an entry's primary name + every alias,
// plus which string produced it.
function scoreEntry(queryNorm, entry) {
  const candidates = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
  let best = 0;
  let matchedOn = null;
  for (const c of candidates) {
    const s = similarity(queryNorm, normalizeName(c));
    if (s > best) { best = s; matchedOn = c; }
  }
  return { score: best, matchedOn };
}

const ADVISORY =
  'Indicative pre-screen only. This checks an illustrative sample, NOT the ' +
  'authoritative consolidated lists. You MUST screen this party against the ' +
  'official EU, UK (OFSI), US (OFAC SDN) and UN consolidated lists before ' +
  'transacting. A "no_sample_match" result is not an all-clear.';

// Screen a counterparty name. Returns potential matches (never an all-clear).
//   name       the counterparty name to screen
//   list       optional { entries: [...] }; defaults to the illustrative sample
//   threshold  similarity cut-off for a potential match (default 0.85)
function screen({ name, list, threshold = DEFAULT_THRESHOLD } = {}) {
  const queryNorm = normalizeName(name);
  const cut = Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD;
  const source = (list && Array.isArray(list.entries)) ? list : SAMPLE;

  if (!queryNorm) {
    return { query: String(name || ''), status: 'invalid', reason: 'empty or unscreenable name', matches: [], advisory: ADVISORY };
  }

  const matches = [];
  for (const entry of source.entries) {
    const { score, matchedOn } = scoreEntry(queryNorm, entry);
    if (score >= cut) {
      matches.push({
        id: entry.id,
        name: entry.name,
        type: entry.type || null,
        programme: entry.programme || null,
        listSource: entry.listSource || source.source || null,
        score: Number(score.toFixed(3)),
        matchedOn,
      });
    }
  }
  matches.sort((a, b) => b.score - a.score);

  return {
    query: String(name || ''),
    normalized: queryNorm,
    threshold: cut,
    listSource: source.source || null,
    authoritative: source.authoritative === true,
    // 'potential_match' = escalate. 'no_sample_match' = NOT cleared — the
    // mandatory next step is an authoritative screen (see advisory).
    status: matches.length ? 'potential_match' : 'no_sample_match',
    matchCount: matches.length,
    matches,
    advisory: ADVISORY,
  };
}

// Resolve the list to screen against: the real consolidated list from
// Postgres when it's loaded, else the bundled illustrative sample. Async
// because the real list is a DB read; never throws (store handles errors).
async function getActiveList() {
  try {
    const store = require('./sanctions-list-store');
    const list = await store.loadActiveList();
    if (list && Array.isArray(list.entries) && list.entries.length) return list;
  } catch (_) { /* fall through to sample */ }
  return SAMPLE;
}

// What's currently being screened against (sources + counts + freshness, or
// the sample). Delegates to the store; falls back to sample meta on any error.
async function getListMeta() {
  try {
    return await require('./sanctions-list-store').listMeta();
  } catch (_) {
    return { authoritative: false, source: SAMPLE.source, totalCount: (SAMPLE.entries || []).length, sources: [] };
  }
}

module.exports = {
  DEFAULT_THRESHOLD,
  normalizeName,
  levenshtein,
  similarity,
  screen,
  getActiveList,
  getListMeta,
  SAMPLE,
};
