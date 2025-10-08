import express from 'express';
import { loadConfig, isDevMode, getPort, getBindHost, getRequiredApiKey } from './config.js';
import { logInfo, logError } from './logger.js';
import router from './routes.js';
import { initializeAuth } from './auth.js';

const app = express();
const API_KEY_HEADER = 'x-api-key';
let cachedRequiredApiKey = undefined;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  if (cachedRequiredApiKey === undefined) {
    try {
      cachedRequiredApiKey = getRequiredApiKey();
    } catch (error) {
      logError('Failed to load API key configuration', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (!cachedRequiredApiKey) {
    return next();
  }

  let providedKey = req.headers[API_KEY_HEADER];
  if (Array.isArray(providedKey)) {
    providedKey = providedKey[0];
  }

  if (!providedKey && typeof req.headers.authorization === 'string') {
    const match = req.headers.authorization.match(/^Bearer\s+(.+)$/i);
    if (match) {
      providedKey = match[1];
    }
  }

  if (typeof providedKey === 'string') {
    providedKey = providedKey.trim();
  }

  if (providedKey && providedKey === cachedRequiredApiKey) {
    return next();
  }

  logInfo('Blocked request with invalid or missing API key', {
    path: req.originalUrl || req.url,
    method: req.method,
    clientIp: req.ip || (req.connection ? req.connection.remoteAddress : undefined)
  });

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid or missing API key. Provide the configured API key via the X-API-Key header or an Authorization: Bearer token.'
  });
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(router);

app.get('/', (req, res) => {
  res.json({
    name: 'droid2api',
    version: '1.0.0',
    description: 'OpenAI Compatible API Proxy',
    endpoints: [
      'GET /v1/models',
      'POST /v1/chat/completions',
      'POST /v1/responses',
      'POST /v1/messages'
    ]
  });
});

// 404 处理 - 捕获所有未匹配的路由
app.use((req, res, next) => {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl || req.url,
    path: req.path,
    query: req.query,
    params: req.params,
    body: req.body,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'origin': req.headers['origin'],
      'referer': req.headers['referer']
    },
    ip: req.ip || req.connection.remoteAddress
  };

  console.error('\n' + '='.repeat(80));
  console.error('❌ 非法请求地址');
  console.error('='.repeat(80));
  console.error(`时间: ${errorInfo.timestamp}`);
  console.error(`方法: ${errorInfo.method}`);
  console.error(`地址: ${errorInfo.url}`);
  console.error(`路径: ${errorInfo.path}`);
  
  if (Object.keys(errorInfo.query).length > 0) {
    console.error(`查询参数: ${JSON.stringify(errorInfo.query, null, 2)}`);
  }
  
  if (errorInfo.body && Object.keys(errorInfo.body).length > 0) {
    console.error(`请求体: ${JSON.stringify(errorInfo.body, null, 2)}`);
  }
  
  console.error(`客户端IP: ${errorInfo.ip}`);
  console.error(`User-Agent: ${errorInfo.headers['user-agent'] || 'N/A'}`);
  
  if (errorInfo.headers.referer) {
    console.error(`来源: ${errorInfo.headers.referer}`);
  }
  
  console.error('='.repeat(80) + '\n');

  logError('Invalid request path', errorInfo);

  res.status(404).json({
    error: 'Not Found',
    message: `路径 ${req.method} ${req.path} 不存在`,
    timestamp: errorInfo.timestamp,
    availableEndpoints: [
      'GET /v1/models',
      'POST /v1/chat/completions',
      'POST /v1/responses',
      'POST /v1/messages'
    ]
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  logError('Unhandled error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: isDevMode() ? err.message : undefined
  });
});

(async () => {
  try {
    loadConfig();
    cachedRequiredApiKey = getRequiredApiKey();
    logInfo('Configuration loaded successfully');
    logInfo(`Dev mode: ${isDevMode()}`);

    if (cachedRequiredApiKey) {
      logInfo('API key protection enabled. Remote access requires a valid X-API-Key header.');
    } else {
      logInfo('No API key configured. Server will only listen on 127.0.0.1. Set config.api_key to enable remote access.');
    }

    // Initialize auth system (load and setup API key if needed)
    // This won't throw error if no auth config is found - will use client auth
    await initializeAuth();

    const PORT = getPort();
    const HOST = getBindHost();
    logInfo(`Starting server on ${HOST}:${PORT}...`);

    const server = app.listen(PORT, HOST)
      .on('listening', () => {
        const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
        logInfo(`Server running on http://${displayHost}:${PORT} (bound to ${HOST})`);
        logInfo('Available endpoints:');
        logInfo('  GET  /v1/models');
        logInfo('  POST /v1/chat/completions');
        logInfo('  POST /v1/responses');
        logInfo('  POST /v1/messages');
      })
      .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n${'='.repeat(80)}`);
        console.error(`ERROR: Port ${PORT} is already in use!`);
        console.error('');
        console.error('Please choose one of the following options:');
        console.error(`  1. Stop the process using port ${PORT}:`);
        console.error(`     lsof -ti:${PORT} | xargs kill`);
        console.error('');
        console.error('  2. Change the port in config.json:');
        console.error('     Edit config.json and modify the "port" field');
        console.error(`${'='.repeat(80)}\n`);
        process.exit(1);
      } else {
        logError('Failed to start server', err);
        process.exit(1);
      }
    });
  } catch (error) {
    logError('Failed to start server', error);
    process.exit(1);
  }
})();
