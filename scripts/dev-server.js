#!/usr/bin/env node
// Local dev server for the OrcaTrade site. Serves static files and routes
// /api/<name> to the matching handler in api/<name>.js. No npm deps.
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function safeJoin(base, target) {
  const resolved = path.normalize(path.join(base, target));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function sendStatic(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err) return notFound(res);
    if (stat.isDirectory()) {
      return sendStatic(res, path.join(filePath, 'index.html'));
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

async function handleApi(req, res, apiName) {
  // After Sprint 27 consolidation: handlers live in lib/handlers/, dispatched
  // through api/[...path].js in production. The dev server skips the dispatcher
  // and resolves handlers directly for faster reloads.
  const handlerPath = path.join(ROOT, 'lib', 'handlers', `${apiName}.js`);
  if (!fs.existsSync(handlerPath)) return notFound(res);
  const handler = require(handlerPath);

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      body = await readBody(req);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  }

  const adaptedReq = Object.assign(req, {
    body,
    query: url.parse(req.url, true).query,
  });

  const adaptedRes = res;
  adaptedRes.status = code => { adaptedRes.statusCode = code; return adaptedRes; };
  adaptedRes.json = payload => {
    adaptedRes.setHeader('Content-Type', 'application/json');
    adaptedRes.end(JSON.stringify(payload));
    return adaptedRes;
  };
  adaptedRes.send = body => {
    if (body == null) { adaptedRes.end(); return adaptedRes; }
    if (Buffer.isBuffer(body) || typeof body === 'string') {
      adaptedRes.end(body);
      return adaptedRes;
    }
    return adaptedRes.json(body);
  };

  try {
    await handler(adaptedReq, adaptedRes);
  } catch (error) {
    console.error(`Handler ${apiName} threw:`, error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'Handler error' }));
    } else {
      res.end();
    }
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname || '/';

  if (pathname.startsWith('/api/')) {
    const apiName = pathname.slice(5).replace(/\/$/, '');
    return handleApi(req, res, apiName);
  }

  let target = pathname === '/' ? '/index.html' : pathname;
  const candidate = safeJoin(ROOT, target);
  if (!candidate) return notFound(res);
  sendStatic(res, candidate);
});

server.listen(PORT, () => {
  console.log(`OrcaTrade dev server listening on http://localhost:${PORT}`);
  console.log(`  Analysis page: http://localhost:${PORT}/analysis/`);
  console.log(`  Intelligence page: http://localhost:${PORT}/intelligence.html`);
});
