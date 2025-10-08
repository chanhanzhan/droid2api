import { logDebug } from '../logger.js';
import { getSystemPrompt, getModelReasoning, getUserAgent } from '../config.js';

const MIN_OUTPUT_TOKENS = 16;
const DEFAULT_MAX_TOKENS = 4096;

export function transformToAnthropic(openaiRequest) {
  logDebug('Transforming OpenAI request to Anthropic format');

  const anthropicRequest = {
    model: openaiRequest.model,
    messages: [],
    stream: openaiRequest.stream !== false
  };

  // Handle max_tokens
  const requestedMaxTokens =
    openaiRequest.max_tokens ?? openaiRequest.max_completion_tokens;
  if (requestedMaxTokens !== undefined && requestedMaxTokens !== null) {
    const numeric = Number(requestedMaxTokens);
    const parsed = Number.isFinite(numeric)
      ? numeric
      : DEFAULT_MAX_TOKENS;
    anthropicRequest.max_tokens = Math.max(MIN_OUTPUT_TOKENS, parsed);
  } else {
    anthropicRequest.max_tokens = DEFAULT_MAX_TOKENS;
  }

  // Extract system message(s) and transform other messages
  let systemContent = [];
  
  if (openaiRequest.messages && Array.isArray(openaiRequest.messages)) {
    for (const msg of openaiRequest.messages) {
      // Handle system messages separately
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemContent.push({
            type: 'text',
            text: msg.content
          });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text') {
              systemContent.push({
                type: 'text',
                text: part.text
              });
            } else {
              systemContent.push(part);
            }
          }
        }
        continue; // Skip adding system messages to messages array
      }

      const anthropicMsg = {
        role: msg.role,
        content: []
      };

      if (typeof msg.content === 'string') {
        anthropicMsg.content.push({
          type: 'text',
          text: msg.content
        });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            anthropicMsg.content.push({
              type: 'text',
              text: part.text
            });
          } else if (part.type === 'image_url') {
            anthropicMsg.content.push({
              type: 'image',
              source: part.image_url
            });
          } else {
            anthropicMsg.content.push(part);
          }
        }
      }

      anthropicRequest.messages.push(anthropicMsg);
    }
  }

  // Add system parameter with system prompt prepended
  const systemPrompt = getSystemPrompt();
  if (systemPrompt || systemContent.length > 0) {
    anthropicRequest.system = [];
    // Prepend system prompt as first element if it exists
    if (systemPrompt) {
      anthropicRequest.system.push({
        type: 'text',
        text: systemPrompt
      });
    }
    // Add user-provided system content
    anthropicRequest.system.push(...systemContent);
  }

  // Transform tools if present
  if (openaiRequest.tools && Array.isArray(openaiRequest.tools)) {
    anthropicRequest.tools = openaiRequest.tools.map(tool => {
      if (tool.type === 'function') {
        return {
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters || {}
        };
      }
      return tool;
    });
  }

  // Handle thinking field based on model configuration
  const reasoningLevel = getModelReasoning(openaiRequest.model);
  if (reasoningLevel) {
    const budgetTokens = {
      'low': 4096,
      'medium': 12288,
      'high': 24576
    };
    
    anthropicRequest.thinking = {
      type: 'enabled',
      budget_tokens: budgetTokens[reasoningLevel]
    };
  }
  // If request already has thinking field, respect the configuration rule
  // Remove it if model config is off/invalid, otherwise override with config
  if (openaiRequest.thinking) {
    if (reasoningLevel) {
      const budgetTokens = {
        'low': 4096,
        'medium': 12288,
        'high': 24576
      };
      
      anthropicRequest.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens[reasoningLevel]
      };
    }
    // If reasoningLevel is null (off/invalid), don't add thinking field
  }

  // Pass through other compatible parameters
  if (openaiRequest.temperature != null) {
    anthropicRequest.temperature = openaiRequest.temperature;
  } else {
    anthropicRequest.temperature = 0.7;
  }
  if (openaiRequest.top_p != null) {
    anthropicRequest.top_p = openaiRequest.top_p;
  } else {
    anthropicRequest.top_p = 0.95;
  }
  if (openaiRequest.stop !== undefined) {
    anthropicRequest.stop_sequences = Array.isArray(openaiRequest.stop) 
      ? openaiRequest.stop 
      : [openaiRequest.stop];
  }

  logDebug('Transformed Anthropic request', anthropicRequest);
  return anthropicRequest;
}

export function getAnthropicHeaders(authHeader, clientHeaders = {}, isStreaming = true, modelId = null) {
  // Generate unique IDs if not provided
  const sessionId = clientHeaders['x-session-id'] || generateUUID();
  const messageId = clientHeaders['x-assistant-message-id'] || generateUUID();
  
  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': 'placeholder',
    'authorization': authHeader || '',
    'x-api-provider': 'anthropic',
    'x-factory-client': 'cli',
    'x-session-id': sessionId,
    'x-assistant-message-id': messageId,
    'user-agent': getUserAgent(),
    'x-stainless-timeout': '600',
    'connection': 'keep-alive'
  };

  // Handle anthropic-beta header based on reasoning configuration
  const reasoningLevel = modelId ? getModelReasoning(modelId) : null;
  let betaValues = [];
  
  // Add existing beta values from client headers
  if (clientHeaders['anthropic-beta']) {
    const existingBeta = clientHeaders['anthropic-beta'];
    betaValues = existingBeta.split(',').map(v => v.trim());
  }
  
  // Handle thinking beta based on reasoning configuration
  const thinkingBeta = 'interleaved-thinking-2025-05-14';
  if (reasoningLevel) {
    // Add thinking beta if not already present
    if (!betaValues.includes(thinkingBeta)) {
      betaValues.push(thinkingBeta);
    }
  } else {
    // Remove thinking beta if reasoning is off/invalid
    betaValues = betaValues.filter(v => v !== thinkingBeta);
  }
  
  // Set anthropic-beta header if there are any values
  if (betaValues.length > 0) {
    headers['anthropic-beta'] = betaValues.join(', ');
  }

  // Pass through Stainless SDK headers with defaults
  const stainlessDefaults = {
    'x-stainless-arch': 'x64',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'MacOS',
    'x-stainless-runtime': 'node',
    'x-stainless-retry-count': '0',
    'x-stainless-package-version': '0.57.0',
    'x-stainless-runtime-version': 'v24.3.0'
  };

  // Set helper-method based on streaming
  if (isStreaming) {
    headers['x-stainless-helper-method'] = 'stream';
  }

  // Copy Stainless headers from client or use defaults
  Object.keys(stainlessDefaults).forEach(header => {
    headers[header] = clientHeaders[header] || stainlessDefaults[header];
  });

  // Override timeout from defaults if client provided
  if (clientHeaders['x-stainless-timeout']) {
    headers['x-stainless-timeout'] = clientHeaders['x-stainless-timeout'];
  }

  return headers;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
