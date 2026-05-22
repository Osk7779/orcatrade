'use strict';

// ILLUSTRATIVE sample list for the indicative denied-party pre-screen.
//
// ⚠️ This is NOT the authoritative consolidated list. Every entry here is
// SYNTHETIC — invented to exercise the matching engine (aliases, corporate
// suffixes, vessels, individuals, name-order variance). It deliberately
// contains no real designated persons or entities.
//
// The real EU / UK (OFSI) / US (OFAC SDN) / UN consolidated lists are wired in
// via a follow-up ingestion sprint. Until then the screen returns
// 'no_sample_match' (never 'clear') so a non-hit can never be mistaken for an
// authoritative all-clear. See lib/intelligence/sanctions-screening.js.

module.exports = {
  source: 'ILLUSTRATIVE-SAMPLE',
  authoritative: false,
  updatedAt: '2026-05-22',
  entries: [
    { id: 'SMP-001', type: 'entity', name: 'Volcano Trading Company', aliases: ['Volcano Trade Co', 'Vulkan Handel GmbH'], programme: 'ILLUSTRATIVE', listSource: 'SAMPLE' },
    { id: 'SMP-002', type: 'individual', name: 'Ivan Petrov', aliases: ['Petrov, Ivan', 'Ivan Petroff'], programme: 'ILLUSTRATIVE', listSource: 'SAMPLE' },
    { id: 'SMP-003', type: 'vessel', name: 'MV Northern Star', aliases: ['Northern Star'], programme: 'ILLUSTRATIVE', listSource: 'SAMPLE' },
    { id: 'SMP-004', type: 'entity', name: 'Crescent Marine Logistics LLC', aliases: ['Crescent Marine'], programme: 'ILLUSTRATIVE', listSource: 'SAMPLE' },
    { id: 'SMP-005', type: 'entity', name: 'Polar Metals OAO', aliases: ['Polar Metals'], programme: 'ILLUSTRATIVE', listSource: 'SAMPLE' },
  ],
};
