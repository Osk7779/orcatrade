// Operations Orchestrator chat UI.
// Same skeleton as the Compliance / Logistics agents, with two extras:
//   - Tool-trace rows show a domain badge (compliance / logistics / shared)
//   - The final message can render a "domains touched" pill row

const API_ENDPOINT = '/api/orchestrator';

const els = {
  conversation: document.getElementById('conversation'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  suggestions: document.getElementById('suggestions'),
  year: document.getElementById('year'),
};

if (els.year) els.year.textContent = new Date().getFullYear();

const state = {
  messages: [],
  inFlight: false,
  currentAgentMsg: null,
  currentToolTrace: null,
  currentTextEl: null,
};

const TOOL_LABELS = {
  // Compliance
  searchRegulations: 'Searching regulation corpus',
  checkCbamApplicability: 'Checking CBAM applicability',
  estimateCbamExposure: 'Estimating CBAM exposure',
  checkEudrApplicability: 'Checking EUDR applicability',
  assessEudrCompliance: 'Assessing EUDR compliance',
  checkReachApplicability: 'Checking REACH applicability',
  assessReachCompliance: 'Assessing REACH compliance',
  checkCeApplicability: 'Checking CE marking applicability',
  assessCeCompliance: 'Assessing CE compliance',
  // Logistics
  compareTransportModes: 'Comparing transport modes',
  estimateLandedCost: 'Estimating landed cost',
  compareWarehouseHubs: 'Benchmarking 3PL hubs',
  recommendShipmentPlan: 'Composing shipment plan',
  getDestinationVatRate: 'Looking up VAT rate',
  // Shared
  lookupHsCode: 'Suggesting HS code',
  requestHumanReview: 'Routing to human reviewer',
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text == null ? '' : text);
  return div.innerHTML;
}

function citationsToChips(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(/\[([a-z0-9][a-z0-9_\-]+)\]/gi, (_, id) => {
    return `<span class="cite" title="${escapeHtml(id)}">${escapeHtml(id)}</span>`;
  });
}

function appendUserMessage(text) {
  const article = document.createElement('article');
  article.className = 'msg msg--user';
  article.innerHTML = `<div class="msg-content">${escapeHtml(text)}</div>`;
  els.conversation.appendChild(article);
  scrollToBottom();
}

function startAgentMessage() {
  const article = document.createElement('article');
  article.className = 'msg msg--agent';
  article.innerHTML = `
    <span class="role-tag">Orchestrator</span>
    <div class="agent-status" data-status>Thinking…</div>
  `;
  els.conversation.appendChild(article);
  state.currentAgentMsg = article;
  state.currentToolTrace = null;
  state.currentTextEl = null;
  scrollToBottom();
}

function setAgentStatus(text) {
  if (!state.currentAgentMsg) return;
  const status = state.currentAgentMsg.querySelector('[data-status]');
  if (status) status.textContent = text;
}

function clearAgentStatus() {
  if (!state.currentAgentMsg) return;
  const status = state.currentAgentMsg.querySelector('[data-status]');
  if (status) status.remove();
}

function ensureToolTrace() {
  if (state.currentToolTrace || !state.currentAgentMsg) return state.currentToolTrace;
  const trace = document.createElement('div');
  trace.className = 'tool-trace';
  state.currentAgentMsg.appendChild(trace);
  state.currentToolTrace = trace;
  return trace;
}

function ensureTextEl() {
  if (state.currentTextEl || !state.currentAgentMsg) return state.currentTextEl;
  const div = document.createElement('div');
  div.className = 'msg-content';
  state.currentAgentMsg.appendChild(div);
  state.currentTextEl = div;
  return div;
}

function appendToolCall(toolName, callId, domain) {
  const trace = ensureToolTrace();
  if (!trace) return;
  const row = document.createElement('div');
  row.className = 'tool-row pending';
  row.dataset.callId = callId || '';
  const domainBadge = domain ? `<span class="domain ${domain}">${domain}</span>` : '';
  row.innerHTML = `<span class="icon">…</span><span>${escapeHtml(TOOL_LABELS[toolName] || toolName)}</span>${domainBadge}`;
  trace.appendChild(row);
  scrollToBottom();
}

function markToolResult(callId, ok, errorMessage) {
  if (!state.currentToolTrace) return;
  const row = state.currentToolTrace.querySelector(`.tool-row[data-call-id="${callId}"]`);
  if (!row) return;
  row.classList.remove('pending');
  row.classList.add(ok ? 'ok' : 'fail');
  const icon = row.querySelector('.icon');
  if (icon) icon.textContent = ok ? '✓' : '✗';
  if (!ok && errorMessage) {
    const note = document.createElement('span');
    note.style.cssText = 'opacity:0.7; margin-left: auto; font-size: 0.74rem;';
    note.textContent = errorMessage.slice(0, 80);
    row.appendChild(note);
  }
}

function appendTextDelta(text) {
  const el = ensureTextEl();
  if (!el) return;
  el.dataset.raw = (el.dataset.raw || '') + text;
  el.innerHTML = OrcaMarkdown.render(el.dataset.raw);
  scrollToBottom();
}

function appendDomainsSummary(domains) {
  if (!domains || !domains.length || !state.currentAgentMsg) return;
  const meaningful = domains.filter(d => d === 'compliance' || d === 'logistics');
  if (!meaningful.length) return;
  const div = document.createElement('div');
  div.className = 'domain-summary';
  div.innerHTML = meaningful.map(d => `<span class="domain-pill ${d}">${d}</span>`).join('');
  state.currentAgentMsg.insertBefore(div, state.currentAgentMsg.firstChild.nextSibling);
}

function finalizeAgentMessage(finalText, domains) {
  clearAgentStatus();
  if (finalText) {
    const el = ensureTextEl();
    if (el && !el.dataset.raw) {
      el.dataset.raw = finalText;
      el.innerHTML = OrcaMarkdown.render(finalText);
    }
  }
  if (domains) appendDomainsSummary(domains);
  state.messages.push({ role: 'assistant', content: finalText || '' });
  state.currentAgentMsg = null;
  state.currentToolTrace = null;
  state.currentTextEl = null;
}

function showError(message) {
  clearAgentStatus();
  const el = ensureTextEl();
  if (el) el.innerHTML = `<span style="color: #c95050;">${escapeHtml(message)}</span>`;
  state.currentAgentMsg = null;
  state.currentToolTrace = null;
  state.currentTextEl = null;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}

function handleEvent(event) {
  switch (event.type) {
    case 'thinking':
      setAgentStatus('Thinking…');
      break;
    case 'tool-call':
      setAgentStatus(`Running ${event.name}…`);
      appendToolCall(event.name, event.callId, event.domain);
      break;
    case 'tool-result':
      markToolResult(event.callId, !event.result?.error, event.result?.error);
      break;
    case 'text-delta':
      setAgentStatus('Drafting…');
      appendTextDelta(event.text);
      break;
    case 'final':
      finalizeAgentMessage(event.text, event.domainsTouched);
      break;
    case 'error':
      showError(event.message || 'Agent error');
      break;
    case 'done':
      if (state.currentAgentMsg) finalizeAgentMessage(state.currentTextEl ? state.currentTextEl.dataset.raw || '' : '', null);
      break;
  }
}

async function streamAgent() {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: state.messages }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.body) throw new Error('No response body for streaming.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');
      const dataLines = rawEvent.split('\n').filter(l => l.startsWith('data:'));
      if (!dataLines.length) continue;
      const text = dataLines.map(l => l.slice(5).trim()).join('\n');
      if (!text) continue;
      let event;
      try { event = JSON.parse(text); } catch { continue; }
      handleEvent(event);
    }
  }
}

async function send(text) {
  if (state.inFlight || !text) return;
  state.inFlight = true;
  els.send.disabled = true;
  els.input.disabled = true;

  appendUserMessage(text);
  state.messages.push({ role: 'user', content: text });
  startAgentMessage();

  try {
    await streamAgent();
  } catch (error) {
    console.error('Orchestrator stream failed', error);
    showError(error.message || 'Agent stream failed');
  } finally {
    state.inFlight = false;
    els.send.disabled = false;
    els.input.disabled = false;
    els.input.value = '';
    autoResize();
    els.input.focus();
  }
}

function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}

els.input.addEventListener('input', autoResize);
els.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send(els.input.value.trim());
  }
});
els.send.addEventListener('click', () => send(els.input.value.trim()));

els.suggestions.querySelectorAll('.suggestion-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    els.input.value = btn.dataset.prompt;
    autoResize();
    els.input.focus();
  });
});

// ── URL prompt deep-linking + conversation persistence ──────────────
// Added Sprint 28. Reads ?prompt=... from the URL on load and pre-fills the
// input. Persists messages to localStorage so refresh doesn't lose history.
// Adds a Clear-conversation button to the conversation header.

const STORAGE_KEY = 'orcatrade.orchestrator.messages.v1';

function persistMessages() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.messages.slice(-30))); } catch {}
}

function loadPersistedMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(-30);
  } catch { return []; }
}

function rerenderConversation() {
  // Clear all messages except the original agent intro (the first article)
  const allMsgs = els.conversation.querySelectorAll('.msg');
  allMsgs.forEach((m, idx) => { if (idx > 0) m.remove(); });

  // Rebuild from state.messages
  for (const m of state.messages) {
    if (m.role === 'user') {
      appendUserMessage(m.content);
    } else if (m.role === 'assistant' && m.content) {
      const article = document.createElement('article');
      article.className = 'msg msg--agent';
      article.innerHTML = `<span class="role-tag">Agent</span><div class="msg-content"></div>`;
      els.conversation.appendChild(article);
      const body = article.querySelector('.msg-content');
      body.dataset.raw = m.content;
      body.innerHTML = (window.OrcaMarkdown ? window.OrcaMarkdown.render(m.content) : m.content);
    }
  }
}

function clearConversation() {
  state.messages = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  rerenderConversation();
}

function injectClearButton() {
  if (!els.conversation || els.conversation.dataset.clearWired) return;
  els.conversation.dataset.clearWired = 'true';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Clear conversation';
  btn.style.cssText = 'align-self: flex-end; background: transparent; border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.6); padding: 4px 12px; font-family: inherit; font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; transition: all 0.15s; margin-bottom: -0.4rem;';
  btn.addEventListener('mouseover', () => { btn.style.color = 'rgba(255,255,255,0.95)'; btn.style.borderColor = 'rgba(184,190,200,0.4)'; });
  btn.addEventListener('mouseout',  () => { btn.style.color = 'rgba(255,255,255,0.6)'; btn.style.borderColor = 'rgba(255,255,255,0.12)'; });
  btn.addEventListener('click', () => {
    if (state.messages.length === 0) return;
    if (confirm('Clear this conversation? History will be deleted.')) clearConversation();
  });
  els.conversation.parentNode.insertBefore(btn, els.conversation);
}

// Hook into send() so persistence fires on every turn — wrap the existing fn.
const _originalSend = send;
send = async function (text) {
  await _originalSend(text);
  persistMessages();
};

// Hook into finalizeAgentMessage too — captures full final text after streaming.
const _originalFinalize = finalizeAgentMessage;
finalizeAgentMessage = function (finalText, ...rest) {
  const result = _originalFinalize.call(this, finalText, ...rest);
  persistMessages();
  return result;
};

// On page load: restore messages, prefill from URL, inject Clear button.
document.addEventListener('DOMContentLoaded', () => {
  injectClearButton();

  const persisted = loadPersistedMessages();
  if (persisted.length) {
    state.messages = persisted;
    rerenderConversation();
  }

  const params = new URLSearchParams(window.location.search);
  const promptParam = params.get('prompt');
  if (promptParam) {
    els.input.value = promptParam;
    autoResize();
    els.input.focus();
  }
});

// Edge case: if DOMContentLoaded already fired before this script ran (rare),
// run init synchronously.
if (document.readyState !== 'loading') {
  injectClearButton();
  const persisted = loadPersistedMessages();
  if (persisted.length) { state.messages = persisted; rerenderConversation(); }
  const params = new URLSearchParams(window.location.search);
  const p = params.get('prompt');
  if (p) { els.input.value = p; autoResize(); els.input.focus(); }
}
