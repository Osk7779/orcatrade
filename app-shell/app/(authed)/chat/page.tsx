'use client';

import { useRef, useState } from 'react';

type Role = 'user' | 'assistant';
interface Msg { role: Role; content: string }

// The orchestrator streams Server-Sent Events; parse them off the fetch body.
async function streamOrchestrator(
  messages: Msg[],
  onText: (delta: string) => void,
  onTool: (label: string | null) => void,
): Promise<void> {
  const res = await fetch('/api/orchestrator', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() || '';
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data:')) continue;
      let evt: { type: string; text?: string; name?: string; domain?: string; message?: string };
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (evt.type === 'text-delta' && evt.text) { onText(evt.text); onTool(null); }
      else if (evt.type === 'tool-call') onTool(`${evt.domain || 'tool'} · ${evt.name}`);
      else if (evt.type === 'tool-result') onTool(null);
      else if (evt.type === 'thinking') onTool('thinking');
      else if (evt.type === 'error') throw new Error(evt.message || 'agent error');
      // 'final' text is the accumulation of text-delta we already have; 'done' ends the stream.
    }
  }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
      await streamOrchestrator(
        next,
        (delta) => setMessages((cur) => {
          const copy = cur.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + delta };
          return copy;
        }),
        setTool,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The agent could not respond.');
      // Drop the empty assistant bubble on hard failure.
      setMessages((cur) => (cur[cur.length - 1]?.content ? cur : cur.slice(0, -1)));
    } finally {
      setBusy(false);
      setTool(null);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }

  return (
    <div className="max-w-2xl flex flex-col h-[calc(100vh-6rem)]">
      <h1 className="text-4xl mb-1">Ask the agent</h1>
      <p className="font-mono text-xs text-white/45 mb-6">
        Calculator-grounded across customs, logistics, sourcing &amp; finance — every number cites its tool.
      </p>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="text-white/50 text-sm border border-[var(--color-line)] px-5 py-4">
            Ask anything about your imports — e.g. <span className="text-white/75">“What’s the landed cost of 5,000 cotton t-shirts from Vietnam to Poland, and does EVFTA cut my duty?”</span>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[90%] px-4 py-2.5 text-sm whitespace-pre-wrap text-left rounded-sm ${
              m.role === 'user' ? 'bg-[var(--color-accent)] text-[var(--color-ink)]' : 'border border-[var(--color-line)] text-white/85'
            }`}>
              {m.content || (busy && i === messages.length - 1 ? <span className="text-white/40">…</span> : '')}
            </div>
          </div>
        ))}
        {tool && <div className="font-mono text-xs text-[var(--color-accent-soft)]">⚙ {tool}…</div>}
        {err && <div className="text-red-400 text-sm">{err}</div>}
      </div>

      <div className="flex gap-2 pt-4 border-t border-[var(--color-line)] mt-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder="Ask about duty, routing, sourcing, FX, compliance…"
          className="flex-1 resize-none bg-transparent border border-[var(--color-line)] px-3 py-2.5 text-sm rounded-sm text-white"
        />
        <button
          disabled={busy || !input.trim()}
          onClick={send}
          className="px-5 py-2.5 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40 self-end"
        >Send</button>
      </div>
    </div>
  );
}
