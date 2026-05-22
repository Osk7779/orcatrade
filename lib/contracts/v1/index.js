// Frozen response contracts for the public /api/v1/* surface.
//
// WHY (backend-grade-plan non-negotiable #7): once external partners or our
// own long-lived clients consume the API, an accidental field rename / type
// change / removal is a silent breaking change. These schemas pin the shape
// of each stable endpoint; the contract test (test/api-v1-contract.test.js)
// validates real handler output against them on every `npm test`, so drift
// breaks CI before it ships. Breaking changes are deliberate: bump to a v2
// schema, never edit a v1 one.
//
// ADDITIVE BY DESIGN: schemas pin required fields + their types but do NOT
// set additionalProperties:false. Adding a new field is non-breaking and
// passes; removing/renaming/retyping a pinned field fails. That matches the
// contract-stability promise (v1 stays compatible; new data is free).
//
// Zero-dependency: a tiny JSON-Schema subset validator lives here rather
// than pulling ajv (keeps us deployable on Vercel Hobby with no build step).

// ── Minimal validator ───────────────────────────────────────────────────

function jsType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function typeMatches(type, v) {
  switch (type) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}

function check(schema, value, path, errors) {
  // `nullable: true` permits an explicit null regardless of declared type.
  if (schema.nullable && value === null) return;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${jsType(value)}`);
      return; // no point recursing into a type mismatch
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum [${schema.enum.join(', ')}]`);
  }

  if (typeMatches('object', value) && schema.properties) {
    const required = schema.required || [];
    for (const key of required) {
      if (value[key] === undefined) errors.push(`${path}.${key}: required field missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (value[key] !== undefined) check(sub, value[key], `${path}.${key}`, errors);
    }
  }

  if (typeMatches('array', value) && schema.items) {
    value.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
  }
}

// Returns an array of human-readable error strings (empty = valid).
function validate(schema, value) {
  const errors = [];
  check(schema, value, '$', errors);
  return errors;
}

// ── Frozen schemas (v1 — DO NOT edit shapes; add a v2 for breaking changes) ──

const SCHEMAS = {
  // GET /api/v1/tiers — public subscription catalogue.
  tiers: {
    type: 'object',
    required: ['ok', 'catalog', 'defaultTierId'],
    properties: {
      ok: { type: 'boolean' },
      defaultTierId: { type: 'string' },
      catalog: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'name', 'priceMonthlyEur', 'priceAnnualEur', 'quotas', 'features'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            // null on contact-us tiers (Enterprise) — price is quoted, not listed.
            priceMonthlyEur: { type: 'number', nullable: true },
            priceAnnualEur: { type: 'number', nullable: true },
            isFree: { type: 'boolean' },
            requiresContact: { type: 'boolean' },
            quotas: { type: 'object' },
            features: { type: 'object' },
          },
        },
      },
    },
  },

  // GET /api/v1/hs-suggest?q=… — plain-language HS code lookup.
  'hs-suggest': {
    type: 'object',
    required: ['ok', 'query', 'candidates'],
    properties: {
      ok: { type: 'boolean' },
      query: { type: 'string' },
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          required: ['hs6', 'label', 'chapter', 'score'],
          properties: {
            hs6: { type: 'string' },
            label: { type: 'string' },
            chapter: { type: 'string' },
            score: { type: 'number' },
          },
        },
      },
    },
  },

  // POST /api/v1/customs — landed-cost / duty quote (success shape).
  customs: {
    type: 'object',
    required: ['ok', 'duty', 'vat', 'quotes'],
    properties: {
      ok: { type: 'boolean' },
      asOf: { type: 'string' },
      duty: {
        type: 'object',
        required: ['rate', 'ratePercent', 'breakdown', 'tradeDefenceMeasures', 'preferentialApplied'],
        properties: {
          rate: { type: 'number' },
          ratePercent: { type: 'number' },
          mfnRate: { type: 'number' },
          mfnSource: { type: 'string' },
          chapterRate: { type: 'number', nullable: true },
          breakdown: { type: 'array' },
          tradeDefenceMeasures: { type: 'array' },
          // null/false when no preferential regime is claimed; object when applied.
          preferentialApplied: { type: ['boolean', 'object'], nullable: true },
        },
      },
      vat: {
        type: 'object',
        required: ['rate'],
        properties: { rate: { type: 'number' } },
      },
      quotes: { type: 'array' },
    },
  },

  // GET /api/v1/health — operational status probe.
  health: {
    type: 'object',
    required: ['status', 'checks'],
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
      checks: { type: 'object' },
    },
  },
};

module.exports = { validate, SCHEMAS, typeMatches };
