const { createCacheKey } = require('./cache-store');

const MEMORY_NAMESPACES = new Map();
const DEFAULT_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cleanString(value) {
  return String(value || '').trim();
}

function safeJsonParse(value, fallback) {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return parsed === undefined ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function cloneValue(value) {
  return safeJsonParse(JSON.stringify(value), value);
}

function getStorageMode() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? 'durable' : 'memory';
}

function getStorePrefix() {
  return cleanString(process.env.ORCATRADE_STORE_PREFIX) || 'orcatrade:intelligence';
}

function getMemoryNamespace(name) {
  if (!MEMORY_NAMESPACES.has(name)) {
    MEMORY_NAMESPACES.set(name, new Map());
  }

  return MEMORY_NAMESPACES.get(name);
}

function buildStoreKey(kind, namespace, key) {
  return `${getStorePrefix()}:${kind}:${namespace}:${key}`;
}

async function runRedisCommand(args) {
  const baseUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

  if (!baseUrl || !token) {
    throw new Error('Durable store is not configured.');
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    throw new Error(`Durable store request failed with status ${response.status}.`);
  }

  const data = await response.json();
  if (data && data.error) {
    throw new Error(data.error);
  }

  return data ? data.result : null;
}

function purgeExpiredMemoryEntries(store) {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry && entry.expiresAt && entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

async function getDurableJson(key, fallback) {
  const raw = await runRedisCommand(['GET', key]);
  return safeJsonParse(raw, fallback);
}

async function setDurableJson(key, value, ttlMs) {
  await runRedisCommand([
    'SET',
    key,
    JSON.stringify(value),
    'PX',
    String(Math.max(1, Number(ttlMs) || DEFAULT_REPORT_TTL_MS)),
  ]);
}

function getMemoryValue(namespace, key, fallback) {
  const store = getMemoryNamespace(namespace);
  purgeExpiredMemoryEntries(store);
  const entry = store.get(key);
  if (!entry) return fallback;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return fallback;
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
    return cloneValue(entry.value);
  }
  return cloneValue(entry);
}

function setMemoryValue(namespace, key, value, ttlMs) {
  const store = getMemoryNamespace(namespace);
  purgeExpiredMemoryEntries(store);
  const expiresAt = Date.now() + Math.max(1, Number(ttlMs) || DEFAULT_REPORT_TTL_MS);
  store.set(key, { value: cloneValue(value), expiresAt });
  return { expiresAt };
}

function buildAccountReportSummary(reportRecord) {
  const report = reportRecord && reportRecord.report ? reportRecord.report : {};
  const ownership = report.reportOwnership || {};
  const lineage = report.reportLineage || {};
  const readiness = report.decisionReadiness || {};
  return {
    reportId: cleanString(report.reportId),
    reportFamilyId: cleanString(lineage.reportFamilyId),
    reportVersion: Math.max(1, Number(lineage.reportVersion) || 1),
    previousReportId: cleanString(lineage.parentReportId),
    evidenceSnapshotId: cleanString(report.evidenceSnapshot?.snapshotId),
    storedAt: cleanString(reportRecord.storedAt),
    timestamp: cleanString(report.timestamp),
    overallStatus: cleanString(report.overallStatus),
    overallScore: Number(report.overallScore) || 0,
    readinessLevel: cleanString(readiness.level),
    productCategory: cleanString(reportRecord.orderData?.productCategory),
    origin: cleanString(reportRecord.orderData?.origin),
    company: cleanString(ownership.company || reportRecord.orderData?.company),
    accountLabel: cleanString(ownership.accountLabel),
  };
}

function buildVersionSummary(reportRecord) {
  const report = reportRecord && reportRecord.report ? reportRecord.report : {};
  const ownership = report.reportOwnership || {};
  const lineage = report.reportLineage || {};
  const readiness = report.decisionReadiness || {};
  const evidence = report.evidenceSnapshot || {};
  return {
    reportId: cleanString(report.reportId),
    reportFamilyId: cleanString(lineage.reportFamilyId),
    reportVersion: Math.max(1, Number(lineage.reportVersion) || 1),
    previousReportId: cleanString(lineage.parentReportId) || null,
    generatedAt: cleanString(report.timestamp || lineage.generatedAt),
    storedAt: cleanString(reportRecord.storedAt),
    overallStatus: cleanString(report.overallStatus),
    overallScore: Number(report.overallScore) || 0,
    readinessLevel: cleanString(readiness.level),
    generationMode: cleanString(report.reportGeneration?.mode),
    evidenceSnapshotId: cleanString(evidence.snapshotId),
    evidenceProvidedFields: Number(evidence.completeness?.providedFields) || 0,
    evidenceMissingFields: Number(evidence.completeness?.missingFields) || 0,
    company: cleanString(ownership.company || reportRecord.orderData?.company),
    accountLabel: cleanString(ownership.accountLabel),
    productCategory: cleanString(reportRecord.orderData?.productCategory),
    origin: cleanString(reportRecord.orderData?.origin),
  };
}

function buildEvidenceRecord(reportRecord) {
  const report = reportRecord && reportRecord.report ? reportRecord.report : {};
  const lineage = report.reportLineage || {};
  const ownership = report.reportOwnership || {};
  const evidence = report.evidenceSnapshot || {};

  return {
    snapshotId: cleanString(evidence.snapshotId),
    reportId: cleanString(report.reportId),
    reportFamilyId: cleanString(lineage.reportFamilyId),
    reportVersion: Math.max(1, Number(lineage.reportVersion) || 1),
    storedAt: cleanString(reportRecord.storedAt),
    capturedAt: cleanString(evidence.capturedAt),
    ownerFingerprint: cleanString(ownership.ownerFingerprint),
    accountLabel: cleanString(ownership.accountLabel),
    company: cleanString(ownership.company || reportRecord.orderData?.company),
    completeness: cloneValue(evidence.completeness || {}),
    items: cloneValue(Array.isArray(evidence.items) ? evidence.items : []),
    regulationCoverage: cloneValue(Array.isArray(evidence.regulationCoverage) ? evidence.regulationCoverage : []),
  };
}

function buildReportFamilyId(reportRecord) {
  const report = reportRecord && reportRecord.report ? reportRecord.report : {};
  const existing = cleanString(report.reportLineage?.reportFamilyId);
  if (existing) return existing;
  return createCacheKey({
    ownerFingerprint: cleanString(report.reportOwnership?.ownerFingerprint),
    productCategory: cleanString(reportRecord.orderData?.productCategory).toLowerCase(),
    productDescription: cleanString(reportRecord.orderData?.productDescription).toLowerCase(),
    origin: cleanString(reportRecord.orderData?.origin).toLowerCase(),
    supplierName: cleanString(reportRecord.orderData?.supplierName).toLowerCase(),
    importValue: cleanString(reportRecord.orderData?.importValue).toLowerCase(),
  });
}

function buildEvidenceSnapshotId(reportRecord, familyId, versionNumber) {
  const existing = cleanString(reportRecord?.report?.evidenceSnapshot?.snapshotId);
  if (existing) return existing;
  return createCacheKey({
    reportFamilyId: familyId,
    reportVersion: versionNumber,
    reportId: cleanString(reportRecord?.report?.reportId),
    capturedAt: cleanString(reportRecord?.report?.evidenceSnapshot?.capturedAt || reportRecord?.report?.timestamp || reportRecord?.storedAt),
  });
}

async function getSharedCacheValue(namespace, payload) {
  const key = createCacheKey(payload);
  const storageMode = getStorageMode();

  if (storageMode === 'durable') {
    const raw = await runRedisCommand(['GET', buildStoreKey('cache', namespace, key)]);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      await runRedisCommand(['DEL', buildStoreKey('cache', namespace, key)]);
      return null;
    }

    return {
      key,
      value: parsed.value,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      storageMode,
    };
  }

  const store = getMemoryNamespace(`cache:${namespace}`);
  purgeExpiredMemoryEntries(store);
  const entry = store.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }

  return {
    key,
    value: entry.value,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    storageMode,
  };
}

async function setSharedCacheValue(namespace, payload, value, ttlMs) {
  const key = createCacheKey(payload);
  const storageMode = getStorageMode();
  const entry = {
    value,
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(1, Number(ttlMs) || 0),
  };

  if (storageMode === 'durable') {
    await runRedisCommand([
      'SET',
      buildStoreKey('cache', namespace, key),
      JSON.stringify(entry),
      'PX',
      String(Math.max(1, Number(ttlMs) || 0)),
    ]);
    return { key, storageMode };
  }

  const store = getMemoryNamespace(`cache:${namespace}`);
  purgeExpiredMemoryEntries(store);
  store.set(key, entry);
  return { key, storageMode };
}

async function consumeRateLimit(namespace, identifier, limit, windowMs) {
  const normalizedId = cleanString(identifier) || 'unknown';
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60000);
  const now = Date.now();
  const bucketStart = now - (now % safeWindowMs);
  const resetAt = bucketStart + safeWindowMs;
  const storageMode = getStorageMode();
  const key = `${normalizedId}:${bucketStart}`;

  if (storageMode === 'durable') {
    const durableKey = buildStoreKey('rate', namespace, key);
    const count = Number(await runRedisCommand(['INCR', durableKey])) || 0;
    if (count === 1) {
      await runRedisCommand(['PEXPIRE', durableKey, String(safeWindowMs + 1000)]);
    }

    return {
      limited: count > safeLimit,
      count,
      limit: safeLimit,
      resetAt,
      storageMode,
    };
  }

  const store = getMemoryNamespace(`rate:${namespace}`);
  purgeExpiredMemoryEntries(store);

  const entry = store.get(key) || { count: 0, expiresAt: resetAt };
  entry.count += 1;
  entry.expiresAt = resetAt;
  store.set(key, entry);

  return {
    limited: entry.count > safeLimit,
    count: entry.count,
    limit: safeLimit,
    resetAt,
    storageMode,
  };
}

async function persistComplianceReport(report, orderData = {}, cachePayload = {}, ttlMs = DEFAULT_REPORT_TTL_MS) {
  const reportId = cleanString(report && report.reportId);
  if (!reportId) {
    throw new Error('Cannot persist a compliance report without a reportId.');
  }

  const storageMode = getStorageMode();
  const fingerprint = createCacheKey(cachePayload);
  const baseRecord = {
    report: cloneValue(report),
    orderData,
    requestFingerprint: fingerprint,
    storedAt: new Date().toISOString(),
  };
  const familyId = buildReportFamilyId(baseRecord);
  const familyVersions = await listStoredComplianceReportVersions(familyId, { limit: 100, storageModeOverride: storageMode });
  const previousVersion = Array.isArray(familyVersions.versions) && familyVersions.versions.length ? familyVersions.versions[0] : null;
  const nextVersionNumber = previousVersion ? Math.max(1, Number(previousVersion.reportVersion) || 1) + 1 : 1;
  const evidenceSnapshotId = buildEvidenceSnapshotId(baseRecord, familyId, nextVersionNumber);

  const reportRecord = {
    ...baseRecord,
    report: {
      ...baseRecord.report,
      reportLineage: {
        ...(baseRecord.report.reportLineage || {}),
        reportFamilyId: familyId,
        reportVersion: nextVersionNumber,
        parentReportId: cleanString(baseRecord.report.reportLineage?.parentReportId) || cleanString(previousVersion?.reportId) || null,
      },
      evidenceSnapshot: {
        ...(baseRecord.report.evidenceSnapshot || {}),
        snapshotId: evidenceSnapshotId,
        reportFamilyId: familyId,
        reportVersion: nextVersionNumber,
      },
    },
  };

  const ownerFingerprint = cleanString(reportRecord.report?.reportOwnership?.ownerFingerprint);

  const reportKey = buildStoreKey('report', 'compliance', reportId);
  const requestKey = buildStoreKey('report-request', 'compliance', fingerprint);
  const accountKey = ownerFingerprint ? buildStoreKey('report-account', 'compliance', ownerFingerprint) : '';
  const familyKey = buildStoreKey('report-family', 'compliance', familyId);
  const evidenceKey = buildStoreKey('report-evidence', 'compliance', evidenceSnapshotId);
  const versionSummary = buildVersionSummary(reportRecord);
  const evidenceRecord = buildEvidenceRecord(reportRecord);
  const nextFamilyVersions = [versionSummary]
    .concat((familyVersions.versions || []).filter(item => cleanString(item.reportId) !== reportId))
    .sort((left, right) => (Number(right.reportVersion) || 0) - (Number(left.reportVersion) || 0))
    .slice(0, 100);
  const historyMeta = {
    reportFamilyId: familyId,
    currentVersion: nextVersionNumber,
    previousReportId: cleanString(versionSummary.previousReportId) || null,
    latestReportId: reportId,
    totalVersions: nextFamilyVersions.length,
    versions: nextFamilyVersions.slice(0, 25),
  };
  reportRecord.report.reportHistory = historyMeta;
  reportRecord.report.evidenceTrail = {
    snapshotId: evidenceSnapshotId,
    current: evidenceRecord,
    previousSnapshots: nextFamilyVersions
      .filter(item => cleanString(item.evidenceSnapshotId) && cleanString(item.evidenceSnapshotId) !== evidenceSnapshotId)
      .slice(0, 10)
      .map(item => ({
        snapshotId: cleanString(item.evidenceSnapshotId),
        reportId: cleanString(item.reportId),
        reportVersion: Math.max(1, Number(item.reportVersion) || 1),
        generatedAt: cleanString(item.generatedAt),
        storedAt: cleanString(item.storedAt),
      })),
  };

  if (storageMode === 'durable') {
    await setDurableJson(reportKey, reportRecord, ttlMs);
    await runRedisCommand(['SET', requestKey, reportId, 'PX', String(Math.max(1, Number(ttlMs) || DEFAULT_REPORT_TTL_MS))]);
    await setDurableJson(familyKey, nextFamilyVersions, ttlMs);
    await setDurableJson(evidenceKey, evidenceRecord, ttlMs);
    if (accountKey) {
      const existing = await getDurableJson(accountKey, []);
      const summary = buildAccountReportSummary(reportRecord);
      const next = [summary].concat(existing.filter(item => cleanString(item.reportId) !== reportId)).slice(0, 50);
      await setDurableJson(accountKey, next, ttlMs);
    }
    return {
      reportId,
      report: cloneValue(reportRecord.report),
      requestFingerprint: fingerprint,
      reportFamilyId: familyId,
      reportVersion: nextVersionNumber,
      evidenceSnapshotId,
      storageMode,
    };
  }

  setMemoryValue('report:compliance', reportId, reportRecord, ttlMs);
  setMemoryValue('report-request:compliance', fingerprint, reportId, ttlMs);
  setMemoryValue('report-family:compliance', familyId, nextFamilyVersions, ttlMs);
  setMemoryValue('report-evidence:compliance', evidenceSnapshotId, evidenceRecord, ttlMs);
  if (ownerFingerprint) {
    const existing = getMemoryValue('report-account:compliance', ownerFingerprint, []);
    const summary = buildAccountReportSummary(reportRecord);
    const next = [summary].concat(existing.filter(item => cleanString(item.reportId) !== reportId)).slice(0, 50);
    setMemoryValue('report-account:compliance', ownerFingerprint, next, ttlMs);
  }

  return {
    reportId,
    report: cloneValue(reportRecord.report),
    requestFingerprint: fingerprint,
    reportFamilyId: familyId,
    reportVersion: nextVersionNumber,
    evidenceSnapshotId,
    storageMode,
  };
}

async function getStoredEvidenceSnapshotById(snapshotId, options = {}) {
  const normalizedId = cleanString(snapshotId);
  if (!normalizedId) return null;

  const storageMode = options.storageModeOverride || getStorageMode();

  if (storageMode === 'durable') {
    const parsed = await getDurableJson(buildStoreKey('report-evidence', 'compliance', normalizedId), null);
    return parsed ? { ...parsed, storageMode } : null;
  }

  const entry = getMemoryValue('report-evidence:compliance', normalizedId, null);
  return entry ? { ...entry, storageMode } : null;
}

async function listStoredComplianceReportVersions(reportFamilyId, options = {}) {
  const normalizedFamily = cleanString(reportFamilyId);
  if (!normalizedFamily) {
    return { reportFamilyId: '', versions: [], storageMode: options.storageModeOverride || getStorageMode() };
  }

  const limit = Math.max(1, Number(options.limit) || 25);
  const storageMode = options.storageModeOverride || getStorageMode();

  if (storageMode === 'durable') {
    const versions = await getDurableJson(buildStoreKey('report-family', 'compliance', normalizedFamily), []);
    return {
      reportFamilyId: normalizedFamily,
      versions: Array.isArray(versions) ? versions.slice(0, limit) : [],
      storageMode,
    };
  }

  const versions = getMemoryValue('report-family:compliance', normalizedFamily, []);
  return {
    reportFamilyId: normalizedFamily,
    versions: Array.isArray(versions) ? versions.slice(0, limit) : [],
    storageMode,
  };
}

async function hydrateStoredComplianceRecord(record, storageMode) {
  if (!record || !record.report) return record;

  const cloned = cloneValue(record);
  const familyId = cleanString(cloned.report?.reportLineage?.reportFamilyId);
  const evidenceSnapshotId = cleanString(cloned.report?.evidenceSnapshot?.snapshotId);

  const familyVersions = familyId
    ? await listStoredComplianceReportVersions(familyId, { limit: 25, storageModeOverride: storageMode })
    : { versions: [], storageMode };
  const evidenceRecord = evidenceSnapshotId
    ? await getStoredEvidenceSnapshotById(evidenceSnapshotId, { storageModeOverride: storageMode })
    : null;

  cloned.report.reportHistory = {
    reportFamilyId: familyId || null,
    currentVersion: Math.max(1, Number(cloned.report?.reportLineage?.reportVersion) || 1),
    previousReportId: cleanString(cloned.report?.reportLineage?.parentReportId) || null,
    latestReportId: cleanString(familyVersions.versions?.[0]?.reportId) || cleanString(cloned.report?.reportId),
    totalVersions: Array.isArray(familyVersions.versions) ? familyVersions.versions.length : 0,
    versions: Array.isArray(familyVersions.versions) ? familyVersions.versions : [],
  };
  cloned.report.evidenceTrail = {
    snapshotId: evidenceSnapshotId || null,
    current: evidenceRecord,
    previousSnapshots: Array.isArray(familyVersions.versions)
      ? familyVersions.versions
        .filter(item => cleanString(item.evidenceSnapshotId) && cleanString(item.evidenceSnapshotId) !== evidenceSnapshotId)
        .slice(0, 10)
        .map(item => ({
          snapshotId: cleanString(item.evidenceSnapshotId),
          reportId: cleanString(item.reportId),
          reportVersion: Math.max(1, Number(item.reportVersion) || 1),
          generatedAt: cleanString(item.generatedAt),
          storedAt: cleanString(item.storedAt),
        }))
      : [],
  };

  return { ...cloned, storageMode };
}

async function getStoredComplianceReportById(reportId) {
  const normalizedId = cleanString(reportId);
  if (!normalizedId) return null;

  const storageMode = getStorageMode();

  if (storageMode === 'durable') {
    const parsed = await getDurableJson(buildStoreKey('report', 'compliance', normalizedId), null);
    if (!parsed) return null;
    return hydrateStoredComplianceRecord(parsed, storageMode);
  }

  const entry = getMemoryValue('report:compliance', normalizedId, null);
  if (!entry) return null;
  return hydrateStoredComplianceRecord(entry, storageMode);
}

async function getStoredComplianceReportByRequest(cachePayload = {}) {
  const fingerprint = createCacheKey(cachePayload);
  const storageMode = getStorageMode();

  if (storageMode === 'durable') {
    const reportId = await runRedisCommand(['GET', buildStoreKey('report-request', 'compliance', fingerprint)]);
    if (!reportId) return null;
    return getStoredComplianceReportById(reportId);
  }

  const entry = getMemoryValue('report-request:compliance', fingerprint, '');
  if (!entry) return null;
  return getStoredComplianceReportById(entry);
}

async function listStoredComplianceReportsByOwner(ownerFingerprint, options = {}) {
  const normalizedOwner = cleanString(ownerFingerprint);
  if (!normalizedOwner) return { reports: [], storageMode: getStorageMode() };

  const limit = Math.max(1, Number(options.limit) || 10);
  const storageMode = getStorageMode();

  if (storageMode === 'durable') {
    const parsed = await getDurableJson(buildStoreKey('report-account', 'compliance', normalizedOwner), []);
    return {
      reports: Array.isArray(parsed) ? parsed.slice(0, limit) : [],
      storageMode,
    };
  }

  const entry = getMemoryValue('report-account:compliance', normalizedOwner, []);
  return {
    reports: Array.isArray(entry) ? entry.slice(0, limit) : [],
    storageMode,
  };
}

module.exports = {
  consumeRateLimit,
  getSharedCacheValue,
  getStorageMode,
  getStoredEvidenceSnapshotById,
  getStoredComplianceReportById,
  getStoredComplianceReportByRequest,
  listStoredComplianceReportVersions,
  listStoredComplianceReportsByOwner,
  persistComplianceReport,
  setSharedCacheValue,
};
