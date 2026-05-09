// Outbound email composer client (GTM tooling, sprint H5).
//
// Posts the brief to the existing /api/orchestrator endpoint with a system
// directive that pins the OrcaTrade brand voice and asks for a self-contained
// cold email. We re-use the orchestrator instead of adding a new endpoint
// because (a) the orchestrator already has tier gating + rate limits, (b)
// the brand voice fits the orchestrator's persona, (c) no new handler =
// no extra Vercel function.

(function () {
  'use strict';

  var els = {
    form: document.getElementById('ob-form'),
    submit: document.getElementById('ob-submit'),
    err: document.getElementById('ob-err'),
    out: document.getElementById('draft-out'),
    copy: document.getElementById('copy-draft'),
    regen: document.getElementById('regen-draft'),
    meta: document.getElementById('meta-line'),
    recipient: document.getElementById('recipient'),
    company: document.getElementById('company'),
    hook: document.getElementById('hook'),
    goal: document.getElementById('goal'),
    tone: document.getElementById('tone'),
  };

  var GOAL_LABELS = {
    discovery_call: 'a 15-minute discovery call to learn about their import operation',
    free_compliance_brief: 'a free, non-obligation EU compliance brief (CBAM / EUDR / REACH)',
    pricing_walkthrough: 'a 15-minute walkthrough of the OrcaTrade pricing tiers',
    press_intro: 'an interview / quote opportunity for an upcoming piece',
    partner_intro: 'an introduction to discuss potential partnership terms',
  };

  var TONE_GUIDANCE = {
    warm: 'Warm and collegial. Specific to their context. 4–6 sentences. Sign off as "Oskar — OrcaTrade".',
    terse: 'Founder-blunt. 3 sentences MAXIMUM, including ask. No filler. Sign off "Oskar".',
    formal: 'Formal, suitable for multi-stakeholder forwarding. 5–7 sentences. Sign off "Oskar Klepuszewski, Founder & CFO, OrcaTrade Group".',
  };

  function buildPrompt(brief) {
    var goalLine = GOAL_LABELS[brief.goal] || GOAL_LABELS.discovery_call;
    var toneLine = TONE_GUIDANCE[brief.tone] || TONE_GUIDANCE.warm;
    return [
      'Draft a cold outbound email from Oskar Klepuszewski (OrcaTrade founder & CFO) to the recipient below. The email must reflect OrcaTrade\'s positioning: an operating system for European SMEs importing from Asia, AI agents + verified supplier infrastructure, calculator-grounded recommendations, calibrated trust over breadth.',
      '',
      'RECIPIENT: ' + (brief.recipient || 'unknown'),
      'COMPANY: ' + (brief.company || 'unknown'),
      'HOOK / WHY NOW: ' + (brief.hook || '(none provided — find a defensible angle from the company name)'),
      'GOAL OF THE EMAIL: ' + goalLine + '.',
      'TONE: ' + toneLine,
      '',
      'OUTPUT REQUIREMENTS:',
      '— Write a "Subject:" line first, then the email body.',
      '— Email body only. No commentary, no preamble, no explanation of choices.',
      '— Do NOT use generic openers ("I hope this finds you well", "Quick question", "Mind if I jump in").',
      '— Ground at least one sentence in something specific about the recipient/company.',
      '— Lead with their problem, not our product. Mention OrcaTrade by name once.',
      '— End with a single, low-friction ask (e.g. "Worth 15 minutes Wed/Thu next week?").',
      '— Do NOT use exclamation marks. Do NOT use emojis.',
      '— No bullet points. Plain prose only.',
    ].join('\n');
  }

  function readBrief() {
    return {
      recipient: els.recipient.value.trim(),
      company: els.company.value.trim(),
      hook: els.hook.value.trim(),
      goal: els.goal.value,
      tone: els.tone.value,
    };
  }

  function setOutput(text) { els.out.textContent = text; }
  function setErr(msg) { els.err.textContent = msg || ''; }

  async function streamOrchestrator(prompt, onDelta, onDone, onError) {
    try {
      var response = await fetch('/api/orchestrator', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
      if (response.status === 401 || response.status === 402) {
        var j = await response.json().catch(function () { return {}; });
        var msg = j && j.code === 'tier_gate'
          ? 'This tool requires the Growth tier or above. ' + (j.upgradeUrl ? 'See ' + j.upgradeUrl + '.' : '')
          : (j && j.error) || 'Sign-in / subscription required.';
        onError(msg);
        return;
      }
      if (response.status === 429) {
        var j2 = await response.json().catch(function () { return {}; });
        onError((j2 && j2.error) || 'Rate-limited. Try again in a minute.');
        return;
      }
      if (!response.ok) {
        onError('Orchestrator error: HTTP ' + response.status);
        return;
      }
      var ct = response.headers.get('content-type') || '';
      if (ct.indexOf('text/event-stream') === -1) {
        var data = await response.json();
        if (data && data.text) { onDelta(data.text); }
        onDone();
        return;
      }
      // Server-sent events
      var reader = response.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data:')) continue;
          var payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            var ev = JSON.parse(payload);
            if (ev.type === 'text' && ev.text) onDelta(ev.text);
            if (ev.type === 'done') onDone();
            if (ev.type === 'error' && ev.error) onError(ev.error);
          } catch (_e) { /* ignore */ }
        }
      }
      onDone();
    } catch (err) {
      onError(err && err.message ? err.message : 'Network error');
    }
  }

  function submit() {
    setErr('');
    setOutput('Drafting…');
    els.copy.disabled = true;
    els.regen.disabled = true;
    els.submit.disabled = true;
    var brief = readBrief();
    if (!brief.recipient && !brief.company) {
      setErr('Add a recipient or a company before drafting.');
      els.submit.disabled = false;
      setOutput('— Fill the brief and hit "Draft email".');
      return;
    }
    var prompt = buildPrompt(brief);
    var accumulated = '';
    streamOrchestrator(
      prompt,
      function onDelta(text) {
        accumulated += text;
        els.out.textContent = accumulated;
      },
      function onDone() {
        if (!accumulated) {
          setOutput('— No draft returned. Try again or refine the brief.');
        }
        els.submit.disabled = false;
        els.copy.disabled = !accumulated;
        els.regen.disabled = !accumulated;
        els.meta.textContent = accumulated ? 'Draft length: ' + accumulated.length + ' chars · review before sending' : '';
      },
      function onError(msg) {
        setErr(msg);
        setOutput('— Draft failed.');
        els.submit.disabled = false;
      },
    );
  }

  els.form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  els.regen.addEventListener('click', submit);
  els.copy.addEventListener('click', function () {
    var text = els.out.textContent || '';
    if (!text) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        var orig = els.copy.textContent;
        els.copy.textContent = 'Copied ✓';
        setTimeout(function () { els.copy.textContent = orig; }, 1500);
      });
    }
  });
})();
