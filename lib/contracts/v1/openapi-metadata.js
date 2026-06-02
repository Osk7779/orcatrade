'use strict';

// OpenAPI metadata for /api/v1/* endpoints.
//
// Phase 0 task P0.J of docs/execution-plan.md. See ADR 0014.
//
// The contracts in lib/contracts/v1/index.js describe RESPONSE shapes
// only. OpenAPI also needs the path + method + parameters + requestBody
// + tags + summary. This file complements the contracts with that
// metadata. The generator at scripts/generate-openapi.js combines the
// two and emits docs/api/openapi.json.
//
// Keep this file tight: one entry per endpoint, only what OpenAPI needs.
// Anything else (rate limits, auth requirements per endpoint, deprecation
// timeline) ships in a future ADR + extension when we actually need it.

/**
 * Per-endpoint metadata. Keyed by the same name as lib/contracts/v1/index.js
 * SCHEMAS, so the generator can pair them by lookup.
 *
 * @type {Record<string, {
 *   path: string,
 *   method: 'get' | 'post' | 'put' | 'patch' | 'delete',
 *   summary: string,
 *   description: string,
 *   tags: string[],
 *   parameters?: Array<{
 *     name: string,
 *     in: 'query' | 'path' | 'header',
 *     required?: boolean,
 *     description: string,
 *     schema: object,
 *   }>,
 *   requestBody?: {
 *     description: string,
 *     required: boolean,
 *     schema: object,
 *   },
 * }>}
 */
const ENDPOINTS = {
  tiers: {
    path: '/api/v1/tiers',
    method: 'get',
    summary: 'Public subscription catalogue',
    description: 'Returns the live catalogue of subscription tiers — price, quotas, features. ' +
      'Used by the marketing site\'s pricing page + the in-app upgrade flow. ' +
      'Enterprise tiers may have null prices (contact-us).',
    tags: ['catalogue'],
  },

  'hs-suggest': {
    path: '/api/v1/hs-suggest',
    method: 'get',
    summary: 'Plain-language HS code lookup',
    description: 'Given a free-text product description, returns ranked HS6 code candidates with confidence scores. ' +
      'Backs the /start/ wizard\'s code-suggest step + the in-app HS lookup tool.',
    tags: ['compliance'],
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: true,
        description: 'Free-text product description (e.g. "knitted cotton t-shirts", "lithium-ion battery cells").',
        schema: { type: 'string', minLength: 2, maxLength: 200 },
      },
    ],
  },

  customs: {
    path: '/api/v1/customs',
    method: 'post',
    summary: 'Landed-cost and duty quote',
    description: 'Calculates EU customs duty (MFN + chapter rate + applicable preferential regime + trade-defence measures) ' +
      'plus VAT for the import. Returns the full quote breakdown including any applicable anti-dumping / countervailing duties. ' +
      'All money math is integer cents through lib/intelligence/money.js (per ADR 0004).',
    tags: ['compliance', 'finance'],
    requestBody: {
      description: 'The shipment being quoted.',
      required: true,
      schema: {
        type: 'object',
        required: ['hsCode', 'originCountry', 'destinationCountry', 'customsValue'],
        properties: {
          hsCode: { type: 'string', description: 'HS code, 6-10 digits.', minLength: 6, maxLength: 10 },
          originCountry: { type: 'string', description: 'ISO-2 country code of origin (e.g. CN, VN, IN).', minLength: 2, maxLength: 2 },
          destinationCountry: { type: 'string', description: 'ISO-2 country code of destination (EU member or UK).', minLength: 2, maxLength: 2 },
          customsValue: { type: 'object', required: ['amount', 'currency'], properties: {
            amount: { type: 'number', description: 'Customs value in the smallest currency unit (cents).' },
            currency: { type: 'string', description: 'ISO-4217 currency code.', minLength: 3, maxLength: 3 },
          }},
          preferentialClaim: { type: 'string', description: 'Preferential regime to apply if eligible (e.g. EUKFTA, EVFTA, GSP, EBA). Optional.' },
          asOfDate: { type: 'string', description: 'Date the quote should be valid for (ISO-8601 YYYY-MM-DD). Defaults to today.' },
        },
      },
    },
  },

  health: {
    path: '/api/v1/health',
    method: 'get',
    summary: 'Operational status probe',
    description: 'Returns the platform\'s operational status + per-subsystem health checks (KV, Postgres, AI subsystem, ' +
      'Resend circuit, etc.). Used by the uptime workflow + by /status/ + by the runbooks as the first triage step.',
    tags: ['operations'],
  },
};

module.exports = { ENDPOINTS };
