(function () {
  var PREF_KEY = 'orcatradeCachePreference';
  var CACHE_PREFIX = 'orcatrade.cache.';
  var WORKFLOW_PREFIX = 'orcatrade.workflow.';
  var WINDOW_PREFIX = '__ORCATRADE_TEMP__';
  var PREF_LABELS = {
    all: 'Accept all cache',
    essential: 'Essential only',
    reject: 'Reject optional cache',
  };

  function getStorage(type) {
    try {
      return window[type];
    } catch (error) {
      return null;
    }
  }

  function hashString(input) {
    var text = String(input || '');
    var hash = 5381;
    for (var index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash) + text.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
  }

  function stableStringify(value) {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(function (item) { return stableStringify(item); }).join(',') + ']';
    }
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function readPreferenceValue() {
    var storage = getStorage('localStorage');
    if (!storage) return null;

    try {
      var value = storage.getItem(PREF_KEY);
      return PREF_LABELS[value] ? value : null;
    } catch (error) {
      return null;
    }
  }

  function getPreference() {
    return readPreferenceValue() || 'essential';
  }

  function hasUserChoice() {
    return Boolean(readPreferenceValue());
  }

  function getWindowState() {
    if (typeof window.name !== 'string' || window.name.indexOf(WINDOW_PREFIX) !== 0) {
      return {};
    }

    try {
      return JSON.parse(window.name.slice(WINDOW_PREFIX.length)) || {};
    } catch (error) {
      return {};
    }
  }

  function setWindowState(state) {
    try {
      window.name = WINDOW_PREFIX + JSON.stringify(state || {});
    } catch (error) {
      window.name = WINDOW_PREFIX + '{}';
    }
  }

  function clearStoragePrefix(storage, prefix) {
    if (!storage) return;
    try {
      Object.keys(storage).forEach(function (key) {
        if (key.indexOf(prefix) === 0) {
          storage.removeItem(key);
        }
      });
    } catch (error) {
      // Ignore storage cleanup failures.
    }
  }

  function clearCachedData() {
    clearStoragePrefix(getStorage('localStorage'), CACHE_PREFIX);
    clearStoragePrefix(getStorage('sessionStorage'), CACHE_PREFIX);
  }

  function clearWorkflowState(key) {
    var local = getStorage('localStorage');
    var session = getStorage('sessionStorage');
    var namespaced = WORKFLOW_PREFIX + key;

    try {
      if (local) local.removeItem(namespaced);
      if (session) session.removeItem(namespaced);
    } catch (error) {
      // Ignore storage cleanup failures.
    }

    var windowState = getWindowState();
    if (Object.prototype.hasOwnProperty.call(windowState, namespaced)) {
      delete windowState[namespaced];
      setWindowState(windowState);
    }
  }

  function writeWorkflowState(key, value) {
    var preference = getPreference();
    var namespaced = WORKFLOW_PREFIX + key;
    var local = getStorage('localStorage');
    var session = getStorage('sessionStorage');

    clearWorkflowState(key);

    if (preference === 'all' && local) {
      try {
        local.setItem(namespaced, value);
        return;
      } catch (error) {
        // Fall through to session or window memory.
      }
    }

    if (preference === 'essential' && session) {
      try {
        session.setItem(namespaced, value);
        return;
      } catch (error) {
        // Fall through to window memory.
      }
    }

    var windowState = getWindowState();
    windowState[namespaced] = value;
    setWindowState(windowState);
  }

  function readWorkflowState(key) {
    var namespaced = WORKFLOW_PREFIX + key;
    var local = getStorage('localStorage');
    var session = getStorage('sessionStorage');

    try {
      if (local) {
        var localValue = local.getItem(namespaced);
        if (localValue) return localValue;
      }
      if (session) {
        var sessionValue = session.getItem(namespaced);
        if (sessionValue) return sessionValue;
      }
    } catch (error) {
      // Ignore storage read failures and fall back to window memory.
    }

    var windowState = getWindowState();
    return windowState[namespaced] || null;
  }

  function getCacheKey(scope, keyData) {
    return CACHE_PREFIX + scope + ':' + hashString(stableStringify(keyData));
  }

  function getCachedJson(scope, keyData) {
    if (getPreference() !== 'all') return null;

    var storage = getStorage('localStorage');
    if (!storage) return null;

    try {
      var raw = storage.getItem(getCacheKey(scope, keyData));
      if (!raw) return null;

      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
        storage.removeItem(getCacheKey(scope, keyData));
        return null;
      }

      return parsed.value;
    } catch (error) {
      return null;
    }
  }

  function setCachedJson(scope, keyData, value, ttlMs) {
    if (getPreference() !== 'all') return;

    var storage = getStorage('localStorage');
    if (!storage) return;

    try {
      storage.setItem(getCacheKey(scope, keyData), JSON.stringify({
        value: value,
        expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || 0),
      }));
    } catch (error) {
      // Ignore storage write failures.
    }
  }

  function getRequestHeaders() {
    return {
      'x-orcatrade-cache-preference': getPreference(),
    };
  }

  function setPreference(preference) {
    if (!PREF_LABELS[preference]) return;

    var storage = getStorage('localStorage');
    try {
      if (storage) storage.setItem(PREF_KEY, preference);
    } catch (error) {
      // Ignore storage write failures.
    }

    if (preference !== 'all') {
      clearCachedData();
    }

    if (preference === 'reject') {
      clearStoragePrefix(getStorage('localStorage'), WORKFLOW_PREFIX);
      clearStoragePrefix(getStorage('sessionStorage'), WORKFLOW_PREFIX);
      setWindowState({});
    }

    renderWidget();
  }

  function widgetMarkup(preference) {
    return '' +
      '<div class="ot-cache-widget-toggle" id="ot-cache-toggle">Cache settings</div>' +
      '<div class="ot-cache-widget-panel" id="ot-cache-panel">' +
      '  <div class="ot-cache-widget-title">Choose your cache mode</div>' +
      '  <p class="ot-cache-widget-copy">Accept all cache uses browser and server cache for faster repeat checks. Essential only keeps the minimum short-lived workflow state. Reject disables optional caching.</p>' +
      '  <div class="ot-cache-widget-actions">' +
      '    <button type="button" data-pref="all">Accept all</button>' +
      '    <button type="button" data-pref="essential">Essential only</button>' +
      '    <button type="button" data-pref="reject">Reject</button>' +
      '  </div>' +
      '  <div class="ot-cache-widget-current">Current mode: <strong>' + PREF_LABELS[preference] + '</strong></div>' +
      '</div>';
  }

  function attachWidgetEvents(root) {
    var toggle = root.querySelector('#ot-cache-toggle');
    var panel = root.querySelector('#ot-cache-panel');

    if (toggle && panel) {
      toggle.addEventListener('click', function () {
        panel.classList.toggle('visible');
      });
    }

    root.querySelectorAll('[data-pref]').forEach(function (button) {
      button.addEventListener('click', function () {
        setPreference(button.getAttribute('data-pref'));
        if (panel) panel.classList.remove('visible');
      });
    });

    if (!hasUserChoice() && panel) {
      panel.classList.add('visible');
    }
  }

  function ensureWidgetStyles() {
    if (document.getElementById('ot-cache-widget-style')) return;

    var style = document.createElement('style');
    style.id = 'ot-cache-widget-style';
    style.textContent = ''
      + '.ot-cache-widget{position:fixed;right:1rem;bottom:1rem;z-index:1200;font-family:Geist,Arial,sans-serif;}'
      + '.ot-cache-widget-toggle{display:inline-flex;align-items:center;gap:0.35rem;padding:0.6rem 0.9rem;background:rgba(8,12,20,0.92);border:1px solid rgba(255,255,255,0.14);color:#ececec;font-size:0.78rem;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;backdrop-filter:blur(14px);}'
      + '.ot-cache-widget-panel{display:none;width:min(360px,calc(100vw - 2rem));margin-top:0.6rem;padding:1rem 1rem 0.95rem;background:rgba(8,12,20,0.96);border:1px solid rgba(255,255,255,0.14);color:#ececec;box-shadow:0 18px 40px rgba(0,0,0,0.45);backdrop-filter:blur(16px);}'
      + '.ot-cache-widget-panel.visible{display:block;}'
      + '.ot-cache-widget-title{font-size:0.9rem;font-weight:700;margin-bottom:0.55rem;}'
      + '.ot-cache-widget-copy{font-size:0.8rem;line-height:1.6;color:rgba(236,236,236,0.72);margin:0 0 0.85rem;}'
      + '.ot-cache-widget-actions{display:flex;flex-wrap:wrap;gap:0.55rem;margin-bottom:0.8rem;}'
      + '.ot-cache-widget-actions button{border:1px solid rgba(255,255,255,0.16);background:transparent;color:#ececec;padding:0.55rem 0.75rem;font-size:0.74rem;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;}'
      + '.ot-cache-widget-actions button:hover{border-color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.04);}'
      + '.ot-cache-widget-current{font-size:0.75rem;color:rgba(236,236,236,0.72);}'
      + '@media (max-width:640px){.ot-cache-widget{left:1rem;right:1rem;}.ot-cache-widget-toggle{width:100%;justify-content:center;}.ot-cache-widget-panel{width:100%;}}';
    document.head.appendChild(style);
  }

  function renderWidget() {
    if (!document.body) return;

    ensureWidgetStyles();

    var existing = document.getElementById('ot-cache-widget');
    if (existing) existing.remove();

    var root = document.createElement('div');
    root.className = 'ot-cache-widget';
    root.id = 'ot-cache-widget';
    root.innerHTML = widgetMarkup(getPreference());
    document.body.appendChild(root);
    attachWidgetEvents(root);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderWidget, { once: true });
      return;
    }

    renderWidget();
  }

  window.OrcaTradeCachePreference = {
    getPreference: getPreference,
    hasUserChoice: hasUserChoice,
    setPreference: setPreference,
    getCachedJson: getCachedJson,
    setCachedJson: setCachedJson,
    getRequestHeaders: getRequestHeaders,
    writeWorkflowState: writeWorkflowState,
    readWorkflowState: readWorkflowState,
    clearWorkflowState: clearWorkflowState,
  };

  init();
})();
