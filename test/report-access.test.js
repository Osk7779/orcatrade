const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachReportAccess,
  createAccountAccessToken,
  createReportAccessToken,
  createWorkspaceAccessToken,
  verifyAccountAccessToken,
  verifyReportAccessToken,
  verifyWorkspaceAccessToken,
} = require('../lib/intelligence/report-access');

test('report access token roundtrip verifies for the matching report', () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const access = createReportAccessToken('OT-COMP-SECURE-001', {
    issuedAtMs: Date.parse('2026-04-09T10:00:00.000Z'),
    expiresAtMs: Date.parse('2026-04-10T10:00:00.000Z'),
  });

  const verification = verifyReportAccessToken('OT-COMP-SECURE-001', access.token);
  assert.equal(verification.ok, true);
  assert.equal(verification.payload.r, 'OT-COMP-SECURE-001');
});

test('report access token rejects mismatched report identifiers', () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const access = createReportAccessToken('OT-COMP-SECURE-002');
  const verification = verifyReportAccessToken('OT-COMP-OTHER-002', access.token);

  assert.equal(verification.ok, false);
  assert.equal(verification.code, 'report_mismatch');
});

test('attachReportAccess returns a signed retrieval path when a signing secret is available', () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const report = attachReportAccess({
    reportId: 'OT-COMP-SECURE-003',
    reportLineage: {
      inputFingerprint: 'abc123',
    },
  });

  assert.equal(report.reportAccess.enabled, true);
  assert.match(report.reportAccess.retrievalPath, /\/api\/report\?reportId=OT-COMP-SECURE-003&accessToken=/);
  assert.equal(report.workspaceAccess.enabled, false);
});

test('account access token verifies for the matching owner fingerprint', () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const access = createAccountAccessToken('owner-fingerprint-001', {
    issuedAtMs: Date.parse('2026-04-09T10:00:00.000Z'),
    expiresAtMs: Date.parse('2026-04-10T10:00:00.000Z'),
  });

  const verification = verifyAccountAccessToken('owner-fingerprint-001', access.token);
  assert.equal(verification.ok, true);
  assert.equal(verification.payload.r, 'owner-fingerprint-001');
});

test('workspace access token verifies for the matching workspace fingerprint', () => {
  process.env.ORCATRADE_REPORT_SECRET = 'test-report-secret';

  const access = createWorkspaceAccessToken('workspace-fingerprint-001', {
    issuedAtMs: Date.parse('2026-04-09T10:00:00.000Z'),
    expiresAtMs: Date.parse('2026-04-10T10:00:00.000Z'),
  });

  const verification = verifyWorkspaceAccessToken('workspace-fingerprint-001', access.token);
  assert.equal(verification.ok, true);
  assert.equal(verification.payload.r, 'workspace-fingerprint-001');
});
