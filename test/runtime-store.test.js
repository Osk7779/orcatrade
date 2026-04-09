const test = require('node:test');
const assert = require('node:assert/strict');

const {
  consumeRateLimit,
  getSharedCacheValue,
  getStoredComplianceReportById,
  getStoredComplianceReportByRequest,
  listStoredComplianceReportsByOwner,
  persistComplianceReport,
  setSharedCacheValue,
} = require('../lib/intelligence/runtime-store');

test('runtime store returns cached values in memory mode', async () => {
  const payload = { route: 'quick-check', productCategory: 'Steel & Metal', origin: 'India' };
  await setSharedCacheValue('runtime-cache-test', payload, { ok: true }, 1000);

  const cached = await getSharedCacheValue('runtime-cache-test', payload);
  assert.equal(cached.value.ok, true);
  assert.equal(cached.storageMode, 'memory');
});

test('runtime store enforces rate limits in memory mode', async () => {
  const first = await consumeRateLimit('runtime-rate-test', '127.0.0.1', 2, 60000);
  const second = await consumeRateLimit('runtime-rate-test', '127.0.0.1', 2, 60000);
  const third = await consumeRateLimit('runtime-rate-test', '127.0.0.1', 2, 60000);

  assert.equal(first.limited, false);
  assert.equal(second.limited, false);
  assert.equal(third.limited, true);
  assert.equal(third.storageMode, 'memory');
});

test('runtime store persists and retrieves compliance reports in memory mode', async () => {
  const cachePayload = { ruleVersion: 'test-v1', productCategory: 'Steel & Metal', origin: 'China' };
  await persistComplianceReport({
    reportId: 'OT-RUNTIME-001',
    overallStatus: 'at_risk',
    ruleVersion: 'test-v1',
  }, {
    productCategory: 'Steel & Metal',
    origin: 'China',
  }, cachePayload, 1000);

  const byId = await getStoredComplianceReportById('OT-RUNTIME-001');
  const byRequest = await getStoredComplianceReportByRequest(cachePayload);

  assert.equal(byId.report.reportId, 'OT-RUNTIME-001');
  assert.equal(byRequest.report.reportId, 'OT-RUNTIME-001');
  assert.equal(byId.storageMode, 'memory');
});

test('runtime store indexes reports by owner fingerprint in memory mode', async () => {
  const cachePayload = { ruleVersion: 'test-v2', productCategory: 'Furniture & Wood', origin: 'Brazil' };
  await persistComplianceReport({
    reportId: 'OT-RUNTIME-OWNER-001',
    overallStatus: 'at_risk',
    overallScore: 85,
    reportOwnership: {
      ownerFingerprint: 'owner-test-001',
      accountLabel: 'Northline Imports',
    },
  }, {
    productCategory: 'Furniture & Wood',
    origin: 'Brazil',
    company: 'Northline Imports',
  }, cachePayload, 1000);

  const result = await listStoredComplianceReportsByOwner('owner-test-001', { limit: 5 });
  assert.equal(result.storageMode, 'memory');
  assert.equal(result.reports[0].reportId, 'OT-RUNTIME-OWNER-001');
  assert.equal(result.reports[0].company, 'Northline Imports');
});
