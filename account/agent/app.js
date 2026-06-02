// Agent chat surface — apex Stage 3 (the enterprise demo).
//
//   1. GET /api/auth/me                → confirm signed-in
//   2. POST /api/orchestrator           → SSE stream of:
//        { type: 'thinking' }
//        { type: 'text-delta', text }    incremental assistant text
//        { type: 'tool-call', name, domain, args, callId }
//        { type: 'tool-result', name, callId, result }
//        { type: 'final', text, stopReason, domainsTouched }
//        { type: 'error', message }
//        { type: 'done' }
//
// The transcript shows the in-flight tool trace so a customer
// reviewing the conversation can see exactly which calculator the
// orchestrator called for every number it quoted — the
// calculator-grounded discipline made visible. That's the
// load-bearing enterprise-trust differentiator.

(function () {
  'use strict';

  // ── Element refs ────────────────────────────────────────
  var authNeededEl = document.getElementById('agent-auth-needed');
  var loadedEl = document.getElementById('agent-loaded');
  var transcriptEl = document.getElementById('agent-transcript');
  var emptyEl = document.getElementById('agent-empty');
  var formEl = document.getElementById('agent-form');
  var inputEl = document.getElementById('agent-input');
  var submitEl = document.getElementById('agent-submit');
  var examplesEl = document.getElementById('agent-examples');

  // ── In-memory conversation state ────────────────────────
  // Trimmed at send-time to the last 12 turns (matches the
  // orchestrator's server-side trim) so a long session doesn't
  // bloat the request payload.
  var messages = [];

  // ── Helpers ─────────────────────────────────────────────
  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }

  // Surface [chunk-id] citations as monospace pills. The format
  // is e.g. [cbam-art-2] or [eudr-art-3] — alphanumeric +
  // hyphens, bounded by [ ]. The replacement is HTML-safe
  // because we escape FIRST then re-inject the pill markup.
  function renderTextWithCitations(text) {
    var escaped = escapeHtml(text);
    return escaped.replace(
      /\[([a-z0-9][a-z0-9-]{1,80})\]/gi,
      '<span class="citation">[$1]</span>',
    );
  }

  function appendTurn(role) {
    var turn = document.createElement('div');
    turn.className = 'turn ' + role;
    var roleEl = document.createElement('div');
    roleEl.className = 'role';
    roleEl.textContent = role === 'user' ? 'You' : 'Operations Orchestrator';
    var body = document.createElement('div');
    body.className = 'body';
    turn.appendChild(roleEl);
    turn.appendChild(body);
    transcriptEl.appendChild(turn);
    return { turn: turn, body: body };
  }

  function renderToolCall(parentTurn, evt) {
    var trace = parentTurn.querySelector('.trace');
    if (!trace) {
      trace = document.createElement('div');
      trace.className = 'trace';
      var kicker = document.createElement('div');
      kicker.className = 'trace-kicker';
      kicker.textContent = 'Tool calls (live)';
      trace.appendChild(kicker);
      parentTurn.appendChild(trace);
    }
    var tc = document.createElement('div');
    tc.className = 'tool-call';
    tc.dataset.callId = evt.callId || '';
    var nameSpan = document.createElement('span');
    nameSpan.className = 'tc-name';
    nameSpan.textContent = evt.name || 'tool';
    tc.appendChild(nameSpan);
    if (evt.domain) {
      var dom = document.createElement('span');
      dom.className = 'tc-domain';
      dom.textContent = '· ' + evt.domain;
      tc.appendChild(dom);
    }
    if (evt.args && typeof evt.args === 'object' && Object.keys(evt.args).length) {
      var args = document.createElement('span');
      args.className = 'tc-args';
      // Truncate the arg dump so a giant payload doesn't push the
      // tool name off-screen — full args are visible in DevTools
      // via the streamed event log.
      var argStr = JSON.stringify(evt.args);
      args.textContent = argStr.length > 220 ? argStr.slice(0, 220) + '…' : argStr;
      tc.appendChild(args);
    }
    trace.appendChild(tc);
  }

  function markToolResult(parentTurn, evt) {
    var tc = parentTurn.querySelector('[data-call-id="' + (evt.callId || '') + '"]');
    if (!tc) return;
    var failed = evt.result && evt.result.error;
    if (failed) tc.classList.add('failed');
  }

  function setStatus(parentTurn, kind, text) {
    var existing = parentTurn.querySelector('.status-pill');
    if (existing) existing.remove();
    if (!kind) return;
    var pill = document.createElement('div');
    pill.className = 'status-pill ' + kind;
    pill.textContent = text || kind;
    parentTurn.appendChild(pill);
  }

  // ── SSE consumer ────────────────────────────────────────
  // The fetch() body is a text/event-stream; we parse it
  // manually because EventSource doesn't support POST + body.
  function parseSseChunk(buffer) {
    // SSE frames: `data: {json}\n\n`. Split on blank lines.
    var events = [];
    var lines = buffer.split('\n');
    var rest = '';
    var pending = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line === '') {
        if (pending) { events.push(pending); pending = null; }
        continue;
      }
      if (line.indexOf('data:') === 0) {
        var dataLine = line.slice(5).trimStart();
        try {
          pending = JSON.parse(dataLine);
        } catch (_) {
          // Partial frame — stash the rest for the next read.
          rest = lines.slice(i).join('\n');
          pending = null;
          break;
        }
      } else if (i === lines.length - 1) {
        // Last line had no trailing newline — incomplete frame.
        rest = lines.slice(i).join('\n');
      }
    }
    if (pending) events.push(pending);
    return { events: events, rest: rest };
  }

  async function streamAgent(userText) {
    // 1. Render the user's turn immediately.
    var userT = appendTurn('user');
    userT.body.textContent = userText;
    if (emptyEl) emptyEl.hidden = true;

    // 2. Open the agent turn skeleton.
    var agentT = appendTurn('agent');
    setStatus(agentT.turn, 'thinking', 'thinking…');

    // 3. Persist + post.
    messages.push({ role: 'user', content: userText });
    var body = JSON.stringify({ messages: messages.slice(-12) });

    submitEl.disabled = true;
    var assembledText = '';
    try {
      var res = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        if (res.status === 401) {
          showAuthNeeded();
          return;
        }
        if (res.status === 402 || res.status === 403) {
          // Tier-gate / quota.
          var msg = 'This feature is gated by your subscription tier (Growth or higher). Visit /account/billing/ to upgrade.';
          setStatus(agentT.turn, 'error', 'tier-gated');
          agentT.body.innerHTML = renderTextWithCitations(msg);
          return;
        }
        if (res.status === 429) {
          setStatus(agentT.turn, 'error', 'rate-limited');
          agentT.body.textContent = 'Rate limit hit — give it a few seconds, then try again.';
          return;
        }
        setStatus(agentT.turn, 'error', 'HTTP ' + res.status);
        agentT.body.textContent = 'Request failed (HTTP ' + res.status + ').';
        return;
      }

      // 4. Stream the SSE body.
      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (var i = 0; i < parsed.events.length; i++) {
          var evt = parsed.events[i];
          handleEvent(evt, agentT, function (text) {
            assembledText = text;
          });
        }
      }
      // Drain any trailing frame.
      if (buffer.trim()) {
        var tail = parseSseChunk(buffer + '\n\n');
        for (var j = 0; j < tail.events.length; j++) {
          handleEvent(tail.events[j], agentT, function (text) {
            assembledText = text;
          });
        }
      }

      // 5. Persist the assistant's reply on success.
      if (assembledText) {
        messages.push({ role: 'assistant', content: assembledText });
      }
    } catch (err) {
      setStatus(agentT.turn, 'error', 'connection');
      agentT.body.textContent = 'Streaming failed (' + (err && err.message ? err.message : 'unknown') + ').';
    } finally {
      submitEl.disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }

  function handleEvent(evt, agentT, setAssembled) {
    if (!evt || !evt.type) return;
    if (evt.type === 'thinking') {
      setStatus(agentT.turn, 'thinking', 'thinking…');
      return;
    }
    if (evt.type === 'text-delta') {
      // Maintain a raw-text buffer on the body element so multi-delta
      // text re-renders correctly (citations replaced once we have
      // the full token).
      var prev = agentT.body.dataset.raw || '';
      var next = prev + (evt.text || '');
      agentT.body.dataset.raw = next;
      agentT.body.innerHTML = renderTextWithCitations(next);
      setAssembled(next);
      return;
    }
    if (evt.type === 'tool-call') {
      renderToolCall(agentT.turn, evt);
      return;
    }
    if (evt.type === 'tool-result') {
      markToolResult(agentT.turn, evt);
      return;
    }
    if (evt.type === 'final') {
      // The orchestrator sends the canonical final text — replace
      // any partial accumulation with it so we don't show a stale
      // half-rendered string if the stream coalesced.
      var finalText = evt.text || agentT.body.dataset.raw || '';
      agentT.body.dataset.raw = finalText;
      agentT.body.innerHTML = renderTextWithCitations(finalText);
      setAssembled(finalText);
      setStatus(agentT.turn, 'done', 'done');
      return;
    }
    if (evt.type === 'error') {
      setStatus(agentT.turn, 'error', 'agent error');
      var msg = '(error) ' + (evt.message || 'unknown agent error');
      agentT.body.innerHTML = renderTextWithCitations(msg);
      return;
    }
    if (evt.type === 'done') {
      return;
    }
  }

  function showAuthNeeded() {
    if (authNeededEl) authNeededEl.hidden = false;
    if (loadedEl) loadedEl.hidden = true;
  }
  function showLoaded() {
    if (authNeededEl) authNeededEl.hidden = true;
    if (loadedEl) loadedEl.hidden = false;
  }

  // ── Wire up ─────────────────────────────────────────────
  if (examplesEl) {
    examplesEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-example]');
      if (!btn) return;
      inputEl.value = btn.getAttribute('data-example');
      inputEl.focus();
    });
  }

  if (formEl) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = (inputEl.value || '').trim();
      if (!text) return;
      inputEl.value = '';
      streamAgent(text);
    });
  }

  // ── Bootstrap: confirm signed-in, then render the surface. ──
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) {
      if (r.status === 401) {
        showAuthNeeded();
        return null;
      }
      if (!r.ok) throw new Error('auth check failed');
      return r.json();
    })
    .then(function (me) {
      if (me) showLoaded();
    })
    .catch(function () {
      // Network failure on /me — default to showing the loaded UI
      // so the user can at least try the form. The /orchestrator
      // call will gate on auth anyway.
      showLoaded();
    });
}());
