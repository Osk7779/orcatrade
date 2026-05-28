'use client';

import { useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';

type Role = 'user' | 'assistant';
interface Msg {
  role: Role;
  content: string;
}

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
      let evt: {
        type: string;
        text?: string;
        name?: string;
        domain?: string;
        message?: string;
      };
      try {
        evt = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (evt.type === 'text-delta' && evt.text) {
        onText(evt.text);
        onTool(null);
      } else if (evt.type === 'tool-call') onTool(`${evt.domain || 'tool'} · ${evt.name}`);
      else if (evt.type === 'tool-result') onTool(null);
      else if (evt.type === 'thinking') onTool('thinking');
      else if (evt.type === 'error') throw new Error(evt.message || 'agent error');
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
        (delta) =>
          setMessages((cur) => {
            const copy = cur.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant')
              copy[copy.length - 1] = { ...last, content: last.content + delta };
            return copy;
          }),
        setTool,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The agent could not respond.');
      setMessages((cur) => (cur[cur.length - 1]?.content ? cur : cur.slice(0, -1)));
    } finally {
      setBusy(false);
      setTool(null);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] max-w-[800px] flex-col md:h-[calc(100vh-6rem)]">
      <PageHeader
        kicker="Ask the agent"
        title="Calculator-grounded, every number cited."
        sub="The agent reasons across customs, logistics, sourcing and finance — each number it surfaces names the tool that produced it."
      />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pr-1"
      >
        {messages.length === 0 && (
          <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6 md:p-7">
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
                ❦
              </span>
              <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                Try one of these
              </span>
            </div>
            <p
              className="mt-4 font-serif text-[1rem] italic leading-[1.5] text-[var(--color-ivory-dim)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
            >
              &ldquo;What is the landed cost of 5,000 cotton t-shirts from Vietnam to
              Poland, and does EVFTA cut my duty?&rdquo;
            </p>
          </div>
        )}

        <div className="flex flex-col gap-5 pt-5">
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[88%] bg-[var(--color-ivory)] px-5 py-3 text-[14.5px] leading-[1.55] text-[var(--color-ink)] whitespace-pre-wrap'
                    : 'max-w-[88%] border border-[var(--color-navy-line)] bg-[var(--color-ink)] px-5 py-3.5 text-[14.5px] leading-[1.65] text-[var(--color-ivory)] whitespace-pre-wrap'
                }
              >
                {m.content || (busy && i === messages.length - 1 ? (
                  <span className="font-serif italic text-[var(--color-ivory-mute)]">
                    composing…
                  </span>
                ) : '')}
              </div>
            </div>
          ))}
        </div>

        {tool && (
          <div className="mt-5 flex items-center gap-2 font-mono text-[12px] tracking-tight text-[var(--color-ivory-mute)]">
            <span
              aria-hidden
              className="inline-block size-1.5 animate-pulse bg-[var(--color-ivory-dim)]"
            />
            {tool}…
          </div>
        )}

        {err && (
          <div className="mt-5 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
            <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-[var(--color-navy-line)] pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Ask about duty, routing, sourcing, FX, compliance…"
            className="flex-1 resize-none border border-[var(--color-navy-line)] bg-transparent p-3.5 text-[14px] leading-[1.6] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
          />
          <button
            disabled={busy || !input.trim()}
            onClick={send}
            className="group inline-flex shrink-0 items-center justify-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Send'}
            {!busy && (
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
