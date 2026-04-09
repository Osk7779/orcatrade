const { createCacheKey } = require('./cache-store');

const MEMORY_NAMESPACES = new Map();
const DEFAULT_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cleanString(value) {
  return String(value || '').trim();
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
  const reportRecord = {
    report,
    orderData,
    requestFingerprint: fingerprint,
    storedAt: new Date().toISOString(),
  };

  const reportKey = buildStoreKey('report', 'compliance', reportId);
  const requestKey = buildStoreKey('report-request', 'compliance', fingerprint);

  if (storageMode === 'durable') {
    await runRedisCommand(['SET', reportKey, JSON.stringify(reportRecord), 'PX', String(Math.max(1, Number(ttlMs) || DEFAULT_REPORT_TTL_MS))]);
    await runRedisCommand(['SET', requestKey, reportId, 'PX', String(Math.max(1, Number(ttlMs) || DEFAULT_REPORT_TTL_MS))]);
    return { reportId, requestFingerprint: fingerprint, storageMode };
  }

  const reportStore = getMemoryNamespace('report:compliance');
  const requestStore = getMemoryNamespace('report-request:compliance');
  const expiresAt = Date.now() + Math.max(1, Number(ttlMs) || DEFAULT_REPORT_TTL_MS);

  purgeExpiredMemoryEntries(reportStore);
  purgeExpiredMemoryEntries(requestStore);
  reportStore.set(reportId, { ...reportRecord, expiresAt });
  requestStore.set(fingerprint, { value: reportId, expiresAt });

  return { reportId, requestFingerprint: fingerprint, storageMode };
}

async function getStoredComplianceReportById(reportId) {
  const normalizedId = cleanString(reportId);
  if (!normalizedId) return null;

  const storageMode = getStorageMode();

  if (storageMode === 'durable') {
    const raw = await runRedisCommand(['GET', buildStoreKey('report', 'compliance', normalizedId)]);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed ? { ...parsed, storageMode } : null;
  }

  const store = getMemoryNamespace('report:compliance');
  purgeExpiredMemoryEntries(store);
  const entry = store.get(normalizedId);
  if (!entry) return null;
  return { ...entry, storageMode };
}

async function getStoredComplianceReportByRequest(cachePayload = {}) {
  const fingerprint = createCacheKey(cachePayload);
  const storageMode = getStorageMode();

  if (storageMode === 'durable') {
    const reportId = await runRedisCommand(['GET', buildStoreKey('report-request', 'compliance', fingerprint)]);
    if (!reportId) return null;
    return getStoredComplianceReportById(reportId);
  }

  const store = getMemoryNamespace('report-request:compliance');
  purgeExpiredMemoryEntries(store);
  const entry = store.get(fingerprint);
  if (!entry || !entry.value) return null;
  return getStoredComplianceReportById(entry.value);
}

module.exports = {
  consumeRateLimit,
  getSharedCacheValue,
  getStorageMode,
  getStoredComplianceReportById,
  getStoredComplianceReportByRequest,
  persistComplianceReport,
  setSharedCacheValue,
};
