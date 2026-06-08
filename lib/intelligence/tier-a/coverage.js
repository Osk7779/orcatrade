// @ts-check
'use strict';

// Tier-A precondition TA-5 — calculator coverage manifest helpers.
//
// Each calculator that wants its outputs to be Tier-A-eligible declares
// a COVERAGE manifest describing the input space it stands behind. An
// input falls "within coverage" iff every declared axis admits it.
//
// Per ADR 0020: "outputs from edge-case extrapolation never qualify."
// The right answer to a Tier-A miss is to widen the declared envelope
// (with regression-test backing), not to relax the eligibility rules.
//
// Axis types (extensible — add new shapes via _axisMatchers below)
// ────────────────────────────────────────────────────────────────
//   { type: 'all' }                         every value passes
//   { type: 'set', values: [...] }          value ∈ values (string compare)
//   { type: 'prefixSet', values: ['84','85'] }  value starts with one of the prefixes
//   { type: 'range', min, max }             for numerics, min ≤ value ≤ max (inclusive)
//   { type: 'integer-range', min, max }     same but rejects non-integer values
//
// COVERAGE manifest shape (calculator-declared)
// ─────────────────────────────────────────────
//   {
//     calculatorName: 'customs-quote',
//     version: 1,                         // bump on envelope change
//     axes: {
//       hsChapter:        { type: 'prefixSet', values: ['01','02', ...] },
//       originCountry:    { type: 'set', values: ['CN','VN','IN','BD','TR'] },
//       destCountry:      { type: 'set', values: ['AT','BE','DE', ...] },
//       declaredValueCents: { type: 'integer-range', min: 100, max: 100_000_000_00 },
//     },
//   }
//
// coverageInput shape (passed per evaluation)
// ───────────────────────────────────────────
// Must supply a value for every axis the manifest declares. Missing
// axes fail TA-5 with a 'missing-input-axis' reason so silent gaps
// surface immediately rather than passing by default.

/**
 * @typedef {{ type: 'all' }} AllAxis
 * @typedef {{ type: 'set', values: string[] }} SetAxis
 * @typedef {{ type: 'prefixSet', values: string[] }} PrefixSetAxis
 * @typedef {{ type: 'range', min: number, max: number }} RangeAxis
 * @typedef {{ type: 'integer-range', min: number, max: number }} IntegerRangeAxis
 * @typedef {AllAxis | SetAxis | PrefixSetAxis | RangeAxis | IntegerRangeAxis} Axis
 *
 * @typedef {Object} CoverageManifest
 * @property {string} calculatorName
 * @property {number} version
 * @property {Object<string, Axis>} axes
 */

const _axisMatchers = {
  all() { return { within: true }; },

  /**
   * @param {SetAxis} axis
   * @param {unknown} value
   */
  set(axis, value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { within: false, reason: 'non-string-or-number-value', value };
    }
    const v = String(value);
    if (!Array.isArray(axis.values)) return { within: false, reason: 'malformed-axis-values' };
    if (!axis.values.includes(v)) return { within: false, reason: 'not-in-set', value: v, allowed: axis.values };
    return { within: true };
  },

  /**
   * @param {PrefixSetAxis} axis
   * @param {unknown} value
   */
  prefixSet(axis, value) {
    if (typeof value !== 'string') return { within: false, reason: 'non-string-value', value };
    if (!Array.isArray(axis.values)) return { within: false, reason: 'malformed-axis-values' };
    const hit = axis.values.some((p) => typeof p === 'string' && value.startsWith(p));
    if (!hit) return { within: false, reason: 'no-prefix-match', value, allowedPrefixes: axis.values };
    return { within: true };
  },

  /**
   * @param {RangeAxis} axis
   * @param {unknown} value
   */
  range(axis, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { within: false, reason: 'non-numeric-value', value };
    }
    if (!(typeof axis.min === 'number' && typeof axis.max === 'number')) {
      return { within: false, reason: 'malformed-axis-range' };
    }
    if (value < axis.min || value > axis.max) {
      return { within: false, reason: 'out-of-range', value, min: axis.min, max: axis.max };
    }
    return { within: true };
  },

  /**
   * @param {IntegerRangeAxis} axis
   * @param {unknown} value
   */
  'integer-range'(axis, value) {
    if (!Number.isInteger(value)) {
      return { within: false, reason: 'non-integer-value', value };
    }
    return _axisMatchers.range(/** @type {RangeAxis} */ (/** @type {unknown} */ (axis)), value);
  },
};

/**
 * @param {CoverageManifest} manifest
 * @param {Object<string, *>} input
 * @returns {{ within: true } | { within: false, axis: string, [k: string]: any }}
 */
function isWithinCoverage(manifest, input) {
  if (!manifest || typeof manifest !== 'object' || !manifest.axes || typeof manifest.axes !== 'object') {
    return { within: false, axis: '(manifest)', reason: 'malformed-coverage-manifest' };
  }
  if (!input || typeof input !== 'object') {
    return { within: false, axis: '(input)', reason: 'missing-coverage-input' };
  }
  for (const [axisName, axisSpec] of Object.entries(manifest.axes)) {
    if (!axisSpec || typeof axisSpec.type !== 'string') {
      return { within: false, axis: axisName, reason: 'malformed-axis-spec' };
    }
    if (!(axisName in input)) {
      return { within: false, axis: axisName, reason: 'missing-input-axis' };
    }
    const matcher = _axisMatchers[axisSpec.type];
    if (!matcher) {
      return { within: false, axis: axisName, reason: 'unknown-axis-type', axisType: axisSpec.type };
    }
    const result = matcher(/** @type {any} */ (axisSpec), input[axisName]);
    if (!result.within) {
      // Spread first so the explicit axis name wins over result's keys.
      return { ...result, axis: axisName, within: false };
    }
  }
  return { within: true };
}

module.exports = {
  isWithinCoverage,
  _axisMatchers,
};
