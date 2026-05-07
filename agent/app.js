const API_ENDPOINT = '/api/agent';

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
  searchRegulations: 'Searching regulation corpus',
  checkCbamApplicability: 'Checking CBAM applicability',
  estimateCbamExposure: 'Estimating CBAM exposure',
  checkEudrApplicability: 'Checking EUDR applicability',
  assessEudrCompliance: 'Assessing EUDR compliance',
  lookupHsCode: 'Looking up HS code',
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
    <span class="role-tag">Agent</span>
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

function appendToolCall(toolName, callId) {
  const trace = ensureToolTrace();
  if (!trace) return;
  const row = document.createElement('div');
  row.className = 'tool-row pending';
  row.dataset.callId = callId || '';
  row.innerHTML = `<span class="icon">…</span><span>${escapeHtml(TOOL_LABELS[toolName] || toolName)}</span>`;
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
  // Re-render entire content from buffer for citation chip parsing
  el.dataset.raw = (el.dataset.raw || '') + text;
  el.innerHTML = OrcaMarkdown.render(el.dataset.raw);
  scrollToBottom();
}

function finalizeAgentMessage(finalText) {
  clearAgentStatus();
  if (finalText) {
    const el = ensureTextEl();
    if (el && !el.dataset.raw) {
      el.dataset.raw = finalText;
      el.innerHTML = OrcaMarkdown.render(finalText);
    }
  }
  // Push assistant text into history (text-only, agent loop handles its own tool memory)
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
      appendToolCall(event.name, event.callId);
      break;
    case 'tool-result':
      markToolResult(event.callId, event.ok, event.error);
      break;
    case 'text-delta':
      setAgentStatus('Drafting…');
      appendTextDelta(event.text);
      break;
    case 'final':
      finalizeAgentMessage(event.text);
      break;
    case 'error':
      showError(event.message || 'Agent error');
      break;
    case 'done':
      // Final cleanup if not already finalized
      if (state.currentAgentMsg) finalizeAgentMessage(state.currentTextEl ? state.currentTextEl.dataset.raw || '' : '');
      break;
    default:
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
      try {
        event = JSON.parse(text);
      } catch {
        continue;
      }
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
    console.error('Agent stream failed', error);
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
