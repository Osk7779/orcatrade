(function () {
  'use strict';

  const API_URL = '/api/chat';

  // Inject widget into the page
  const widget = document.createElement('div');
  widget.id = 'chat-widget';
  widget.innerHTML = `
    <button class="chat-toggle" id="chat-toggle" aria-label="Open chat assistant">
      <svg class="chat-icon-chat" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <svg class="chat-icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <div class="chat-panel chat-panel--hidden" id="chat-panel" role="dialog" aria-label="Chat assistant">
      <div class="chat-header">
        <div class="chat-avatar" aria-hidden="true">OT</div>
        <div class="chat-header-info">
          <div class="chat-header-title">OrcaTrade Intelligence</div>
          <div class="chat-header-sub">Shipments, compliance &amp; factory scoring</div>
        </div>
      </div>

      <div class="chat-messages" id="chat-messages" aria-live="polite">
        <div class="chat-msg chat-msg--assistant">
          I stay focused on three live OrcaTrade Intelligence jobs only: track shipments, check EUDR/CBAM/CSDDD compliance, and find &amp; score factories.
        </div>
      </div>

      <form class="chat-form" id="chat-form" autocomplete="off">
        <input
          type="text"
          id="chat-input"
          class="chat-input"
          placeholder="Ask about shipments, compliance, or factories..."
          aria-label="Chat message"
          maxlength="500"
        />
        <button type="submit" id="chat-send" class="chat-send" aria-label="Send message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(widget);

  const toggle  = document.getElementById('chat-toggle');
  const panel   = document.getElementById('chat-panel');
  const msgsEl  = document.getElementById('chat-messages');
  const form    = document.getElementById('chat-form');
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  let history   = [];
  let busy      = false;
  let isOpen    = false;

  function openChat() {
    isOpen = true;
    panel.classList.remove('chat-panel--hidden');
    toggle.classList.add('chat-toggle--open');
    toggle.setAttribute('aria-expanded', 'true');
    setTimeout(() => input.focus(), 50);
  }

  function closeChat() {
    isOpen = false;
    panel.classList.add('chat-panel--hidden');
    toggle.classList.remove('chat-toggle--open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', () => isOpen ? closeChat() : openChat());

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  function scrollBottom() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function appendMsg(role, text) {
    const el = document.createElement('div');
    el.className = `chat-msg chat-msg--${role}`;
    el.textContent = text;
    msgsEl.appendChild(el);
    scrollBottom();
    return el;
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg--assistant chat-msg--typing';
    el.id = 'chat-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    msgsEl.appendChild(el);
    scrollBottom();
    return el;
  }

  function setLoading(state) {
    busy = state;
    sendBtn.disabled = state;
    input.disabled = state;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    input.value = '';
    setLoading(true);

    appendMsg('user', text);
    history.push({ role: 'user', content: text });

    const typingEl = addTyping();

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      typingEl.remove();

      const assistantEl = document.createElement('div');
      assistantEl.className = 'chat-msg chat-msg--assistant';
      msgsEl.appendChild(assistantEl);

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              fullText += parsed.text;
              assistantEl.textContent = fullText;
              scrollBottom();
            }
          } catch (parseErr) {
            // ignore malformed chunks
          }
        }
      }

      if (fullText) {
        history.push({ role: 'assistant', content: fullText });
      }

    } catch {
      typingEl.remove();
      appendMsg('assistant', 'Sorry, something went wrong. Please try again or reach us at orca@orcatrade.pl.');
    } finally {
      setLoading(false);
      input.focus();
    }
  });
})();
