import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let config = null;

export function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configData);
    return config;
  } catch (error) {
    throw new Error(`Failed to load config.json: ${error.message}`);
  }
}

export function getConfig() {
  if (!config) {
    loadConfig();
  }
  return config;
}

export function getModelById(modelId) {
  const cfg = getConfig();
  return cfg.models.find(m => m.id === modelId);
}

export function getEndpointByType(type) {
  const cfg = getConfig();
  return cfg.endpoint.find(e => e.name === type);
}

export function isDevMode() {
  const cfg = getConfig();
  return cfg.dev_mode === true;
}

export function getPort() {
  const cfg = getConfig();
  return cfg.port || 3000;
}

export function getRequiredApiKey() {
  const cfg = getConfig();
  if (!cfg || cfg.api_key === undefined || cfg.api_key === null) {
    return null;
  }

  const key = typeof cfg.api_key === 'string' ? cfg.api_key.trim() : String(cfg.api_key).trim();
  return key.length > 0 ? key : null;
}

export function getBindHost() {
  const cfg = getConfig();
  if (cfg && typeof cfg.bind_host === 'string' && cfg.bind_host.trim()) {
    return cfg.bind_host.trim();
  }

  return getRequiredApiKey() ? '0.0.0.0' : '127.0.0.1';
}

export function getSystemPrompt() {
  const cfg = getConfig();
  return cfg.system_prompt || '';
}

export function getModelReasoning(modelId) {
  const model = getModelById(modelId);
  if (!model || !model.reasoning) {
    return null;
  }
  const reasoningLevel = model.reasoning.toLowerCase();
  if (['low', 'medium', 'high'].includes(reasoningLevel)) {
    return reasoningLevel;
  }
  return null;
}

export function getUserAgent() {
  const cfg = getConfig();
  return cfg.user_agent || 'factory-cli/0.19.3';
}
