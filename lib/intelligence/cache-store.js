const crypto = require('node:crypto');

const CACHE_NAMESPACES = new Map();

function getNamespace(name) {
  if (!CACHE_NAMESPACES.has(name)) {
    CACHE_NAMESPACES.set(name, new Map());
  }

  return CACHE_NAMESPACES.get(name);
}

function stableStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createCacheKey(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function purgeExpired(store) {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (!entry || entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

function getCachedValue(namespace, payload) {
  const store = getNamespace(namespace);
  purgeExpired(store);

  const key = createCacheKey(payload);
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
  };
}

function setCachedValue(namespace, payload, value, ttlMs) {
  const store = getNamespace(namespace);
  purgeExpired(store);

  const key = createCacheKey(payload);
  store.set(key, {
    value,
    createdAt: Date.now(),
    expiresAt: Date.now() + Math.max(1, Number(ttlMs) || 0),
  });

  return key;
}

module.exports = {
  createCacheKey,
  getCachedValue,
  setCachedValue,
  stableStringify,
};
