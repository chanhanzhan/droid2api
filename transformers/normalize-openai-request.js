const MIN_OUTPUT_TOKENS = 16;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 1;

export function normalizeOpenAIStyleRequest(rawRequest = {}) {
  const normalized = { ...rawRequest };

  // Fallback: convert prompt based payloads into OpenAI style messages
  if (!Array.isArray(normalized.messages) || normalized.messages.length === 0) {
    if (typeof normalized.prompt === 'string' && normalized.prompt.trim().length > 0) {
      normalized.messages = [
        {
          role: 'user',
          content: normalized.prompt
        }
      ];
    } else if (Array.isArray(normalized.prompt) && normalized.prompt.length > 0) {
      normalized.messages = normalized.prompt.map(content => ({
        role: 'user',
        content
      }));
    }
  }

  // Ensure max token fields are present and respect provider minimums
  const suppliedMax = normalized.max_tokens ?? normalized.max_completion_tokens;
  if (suppliedMax === undefined || suppliedMax === null) {
    normalized.max_tokens = DEFAULT_MAX_TOKENS;
  } else {
    const numericSupplied = Number(suppliedMax);
    const parsed = Number.isFinite(numericSupplied)
      ? numericSupplied
      : DEFAULT_MAX_TOKENS;
    const clamped = Math.max(MIN_OUTPUT_TOKENS, parsed);
    if (normalized.max_tokens !== undefined) {
      normalized.max_tokens = clamped;
    }
    if (normalized.max_completion_tokens !== undefined) {
      normalized.max_completion_tokens = clamped;
    }
    if (normalized.max_tokens === undefined && normalized.max_completion_tokens === undefined) {
      normalized.max_tokens = clamped;
    }
  }

  // Provide sensible defaults for common OpenAI parameters when omitted
  if (normalized.temperature == null) {
    normalized.temperature = DEFAULT_TEMPERATURE;
  }
  if (normalized.top_p == null) {
    normalized.top_p = DEFAULT_TOP_P;
  }

  return normalized;
}

export default normalizeOpenAIStyleRequest;

