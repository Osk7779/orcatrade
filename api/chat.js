const { consumeRateLimit } = require('../lib/intelligence/runtime-store');
const { streamAnthropicMessage } = require('../lib/intelligence/model-runtime');
const {
  buildFocusedSystemPrompt,
  buildLocalFallbackReply,
  buildOutOfScopeReply,
  buildTriageReply,
  detectPillarIntent,
  isCapabilityQuestion,
  isOutOfScope,
} = require('../lib/intelligence/live-pillars');

const COMPLIANCE_TRIAGE_PATTERN = /\b(cbam|eudr|import|imports|importer|regulation|regulations|penalty|penalties|fine|fines|certificate|declarant|declaration|threshold|supplier|goods|customs|compliance|compliant)\b/i;
const CHAT_MODEL_TIMEOUT_MS = 16000;

function openStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function writeChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function closeStream(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

function streamStaticReply(res, text) {
  writeChunk(res, { text });
  closeStream(res);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('chat', ip, 20, 60000);
  res.setHeader('X-OrcaTrade-Storage-Mode', rate.storageMode);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const trimmedMessages = messages.slice(-12).map(message => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: String(message.content || '').slice(0, 1200),
  }));

  const lastUserMessage = [...trimmedMessages].reverse().find(message => message.role === 'user');
  const lastUserText = lastUserMessage ? lastUserMessage.content : '';
  let intent = detectPillarIntent(lastUserText);

  openStream(res);

  if (isOutOfScope(lastUserText)) {
    return streamStaticReply(res, buildOutOfScopeReply());
  }

  if (intent === 'triage' || isCapabilityQuestion(lastUserText)) {
    if (intent === 'triage' && COMPLIANCE_TRIAGE_PATTERN.test(lastUserText)) {
      intent = 'compliance';
    } else {
      return streamStaticReply(res, buildTriageReply());
    }
  }

  if (!process.env.ORCATRADE_OS_API) {
    return streamStaticReply(res, buildLocalFallbackReply(intent));
  }

  try {
    await streamAnthropicMessage({
      apiKey: process.env.ORCATRADE_OS_API,
      model: 'claude-sonnet-4-6',
      maxTokens: 420,
      system: buildFocusedSystemPrompt(intent),
      messages: trimmedMessages,
      timeoutMs: CHAT_MODEL_TIMEOUT_MS,
      retries: 0,
      onText: async text => {
        writeChunk(res, { text });
      },
    });
    closeStream(res);
  } catch (error) {
    console.error('Claude API error:', error);
    streamStaticReply(res, buildLocalFallbackReply(intent));
  }
};
