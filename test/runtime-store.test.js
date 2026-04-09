const test = require('node:test');
const assert = require('node:assert/strict');

const {
  consumeRateLimit,
  getSharedCacheValue,
  getStoredEvidenceSnapshotById,
  getStoredComplianceReportById,
  getStoredComplianceReportByRequest,
  listStoredComplianceReportVersions,
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

test('runtime store versions related reports into the same family and keeps evidence snapshots', async () => {
  const commonOrderData = {
    company: 'Northline Imports',
    email: 'ops@northline.test',
    productCategory: 'Steel & Metal',
    productDescription: 'Steel fasteners for industrial assemblies',
    origin: 'China',
    supplierName: 'Jiangsu Parts Co.',
    importValue: 'Over €5M',
  };
  const sharedCachePayload = {
    ruleVersion: 'test-v3',
    productCategory: commonOrderData.productCategory,
    productDescription: commonOrderData.productDescription,
    origin: commonOrderData.origin,
    supplierName: commonOrderData.supplierName,
    importValue: commonOrderData.importValue,
  };

  const first = await persistComplianceReport({
    reportId: 'OT-RUNTIME-FAMILY-001',
    timestamp: '2026-04-09T10:00:00.000Z',
    overallStatus: 'at_risk',
    overallScore: 85,
    reportOwnership: {
      ownerFingerprint: 'owner-family-001',
      accountLabel: 'Northline Imports',
      company: 'Northline Imports',
    },
    reportLineage: {
      inputFingerprint: 'input-fingerprint-001',
      subjectFingerprint: 'subject-fingerprint-001',
    },
    evidenceSnapshot: {
      capturedAt: '2026-04-09T10:00:00.000Z',
      completeness: { providedFields: 3, missingFields: 2 },
      items: [{ key: 'cnCode', provided: true, valueSummary: '7208.37' }],
      regulationCoverage: [{ regulation: 'CBAM', applicabilityStatus: 'applicable', missingFacts: [] }],
    },
    decisionReadiness: { level: 'provisional' },
    reportGeneration: { mode: 'deterministic_fallback' },
  }, commonOrderData, sharedCachePayload, 5000);

  const second = await persistComplianceReport({
    reportId: 'OT-RUNTIME-FAMILY-002',
    timestamp: '2026-04-09T11:00:00.000Z',
    overallStatus: 'compliant',
    overallScore: 100,
    reportOwnership: {
      ownerFingerprint: 'owner-family-001',
      accountLabel: 'Northline Imports',
      company: 'Northline Imports',
    },
    reportLineage: {
      inputFingerprint: 'input-fingerprint-001',
      subjectFingerprint: 'subject-fingerprint-001',
    },
    evidenceSnapshot: {
      capturedAt: '2026-04-09T11:00:00.000Z',
      completeness: { providedFields: 5, missingFields: 0 },
      items: [{ key: 'cnCode', provided: true, valueSummary: '7208.37' }],
      regulationCoverage: [{ regulation: 'CBAM', applicabilityStatus: 'applicable', missingFacts: [] }],
    },
    decisionReadiness: { level: 'evidence_backed' },
    reportGeneration: { mode: 'ai_assisted' },
  }, commonOrderData, sharedCachePayload, 5000);

  assert.equal(first.reportFamilyId, second.reportFamilyId);
  assert.equal(first.reportVersion, 1);
  assert.equal(second.reportVersion, 2);
  assert.ok(second.evidenceSnapshotId);

  const versions = await listStoredComplianceReportVersions(first.reportFamilyId, { limit: 10 });
  assert.equal(versions.storageMode, 'memory');
  assert.equal(versions.versions.length, 2);
  assert.equal(versions.versions[0].reportId, 'OT-RUNTIME-FAMILY-002');
  assert.equal(versions.versions[0].reportVersion, 2);
  assert.equal(versions.versions[1].reportId, 'OT-RUNTIME-FAMILY-001');
  assert.equal(versions.versions[1].reportVersion, 1);

  const snapshot = await getStoredEvidenceSnapshotById(second.evidenceSnapshotId);
  assert.equal(snapshot.storageMode, 'memory');
  assert.equal(snapshot.reportId, 'OT-RUNTIME-FAMILY-002');
  assert.equal(snapshot.reportVersion, 2);

  const stored = await getStoredComplianceReportById('OT-RUNTIME-FAMILY-002');
  assert.equal(stored.report.reportLineage.reportFamilyId, first.reportFamilyId);
  assert.equal(stored.report.reportLineage.reportVersion, 2);
  assert.equal(stored.report.reportHistory.currentVersion, 2);
  assert.equal(stored.report.reportHistory.totalVersions, 2);
  assert.equal(stored.report.reportHistory.versions[0].reportId, 'OT-RUNTIME-FAMILY-002');
  assert.equal(stored.report.reportHistory.versions[1].reportId, 'OT-RUNTIME-FAMILY-001');
  assert.equal(stored.report.evidenceTrail.current.snapshotId, second.evidenceSnapshotId);
  assert.equal(stored.report.evidenceTrail.previousSnapshots[0].reportId, 'OT-RUNTIME-FAMILY-001');
});
