const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_COUNT = 1;

function cleanString(value) {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

function createModelError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

async function performAnthropicRequest({ apiKey, body, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRY_COUNT }) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  const maxRetries = Math.max(0, Number(retries) || 0);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeoutId = setTimeout(() => controller.abort(), safeTimeoutMs);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        const responseText = await response.text();
        const retryable = RETRYABLE_STATUS_CODES.has(response.status);
        if (attempt < maxRetries && retryable) {
          await sleep(250 * (attempt + 1));
          continue;
        }

        throw createModelError(`Anthropic request failed with status ${response.status}.`, {
          status: response.status,
          responseText,
          retryable,
          attemptsUsed: attempt + 1,
          durationMs,
          timedOut: false,
        });
      }

      return {
        response,
        attemptsUsed: attempt + 1,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const timedOut = isAbortError(error);
      const retryable = timedOut || error.retryable || error.name === 'TypeError';

      if (attempt < maxRetries && retryable) {
        await sleep(250 * (attempt + 1));
        continue;
      }

      throw createModelError(
        timedOut
          ? `Anthropic request timed out after ${safeTimeoutMs}ms.`
          : cleanString(error.message) || 'Anthropic request failed.',
        {
          status: error.status || 0,
          responseText: error.responseText || '',
          retryable,
          attemptsUsed: error.attemptsUsed || (attempt + 1),
          durationMs: error.durationMs || durationMs,
          timedOut,
          cause: error,
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw createModelError('Anthropic request failed without a recoverable result.');
}

async function requestAnthropicMessage({
  apiKey,
  model,
  maxTokens,
  system,
  messages,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRY_COUNT,
}) {
  const request = await performAnthropicRequest({
    apiKey,
    body: {
      model,
      max_tokens: maxTokens,
      system,
      messages,
    },
    timeoutMs,
    retries,
  });

  return {
    data: await request.response.json(),
    attemptsUsed: request.attemptsUsed,
    durationMs: request.durationMs,
  };
}

async function streamAnthropicMessage({
  apiKey,
  model,
  maxTokens,
  system,
  messages,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 0,
  onText,
}) {
  const request = await performAnthropicRequest({
    apiKey,
    body: {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      stream: true,
    },
    timeoutMs,
    retries,
  });

  if (!request.response.body) {
    throw createModelError('Anthropic stream did not return a readable body.', {
      attemptsUsed: request.attemptsUsed,
      durationMs: request.durationMs,
      timedOut: false,
    });
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of request.response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      separatorIndex = buffer.indexOf('\n\n');

      const dataLines = rawEvent
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(Boolean);

      if (!dataLines.length) continue;

      const payloadText = dataLines.join('\n');
      if (payloadText === '[DONE]') continue;

      let payload = null;
      try {
        payload = JSON.parse(payloadText);
      } catch (error) {
        continue;
      }

      if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta' && payload.delta.text) {
        await onText(payload.delta.text);
      }

      if (payload.type === 'error') {
        throw createModelError(cleanString(payload.error?.message) || 'Anthropic stream error.', {
          status: Number(payload.error?.status) || 0,
          attemptsUsed: request.attemptsUsed,
          durationMs: request.durationMs,
          timedOut: false,
        });
      }
    }
  }

  return {
    attemptsUsed: request.attemptsUsed,
    durationMs: request.durationMs,
  };
}

function extractAnthropicText(data) {
  const parts = Array.isArray(data?.content) ? data.content : [];
  return cleanString(parts.map(part => cleanString(part?.text)).filter(Boolean).join(''));
}

module.exports = {
  extractAnthropicText,
  requestAnthropicMessage,
  streamAnthropicMessage,
};
