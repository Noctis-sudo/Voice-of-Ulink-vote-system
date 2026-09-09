const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const sessions = new Map();
const publicAppUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function sessionView(session) {
  return { id: session.id, name: session.name, votes: session.votes, active: session.active };
}

function serveFile(res, requestPath) {
  const requested = requestPath === '/' ? 'admin.html' : requestPath.slice(1);
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    const type = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      return sendJson(res, 200, { sessions: [...sessions.values()].map(sessionView) });
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readBody(req);
      if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: '姓名不能为空' });
      for (const session of sessions.values()) session.active = false;
      const session = { id: randomUUID(), name: String(body.name).trim(), votes: 0, active: true, devices: new Set() };
      sessions.set(session.id, session);
      const url = `${publicAppUrl || urlBase(req)}/vote.html?session=${encodeURIComponent(session.id)}`;
      return sendJson(res, 201, { session: sessionView(session), url });
    }

    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'invalidate') {
      const session = sessions.get(parts[2]);
      if (!session) return sendJson(res, 404, { error: '会话不存在' });
      session.active = false;
      return sendJson(res, 200, { session: sessionView(session) });
    }

    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'reset') {
      const session = sessions.get(parts[2]);
      if (!session) return sendJson(res, 404, { error: '会话不存在' });
      session.votes = 0;
      session.devices.clear();
      session.active = true;
      return sendJson(res, 200, { session: sessionView(session) });
    }

    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'session') {
      const session = sessions.get(parts[2]);
      if (!session || !session.active) return sendJson(res, 404, { error: '会话不存在或已失效' });
      return sendJson(res, 200, sessionView(session));
    }

    if (req.method === 'POST' && url.pathname === '/api/vote') {
      const body = await readBody(req);
      const session = sessions.get(body.sessionId);
      const deviceId = req.headers['x-device-id'] || body.deviceId;
      if (!session || !session.active) return sendJson(res, 404, { error: '会话不存在或已失效' });
      if (!deviceId) return sendJson(res, 400, { error: '缺少设备标识' });
      if (session.devices.has(deviceId)) return sendJson(res, 409, { error: '此设备已经投过票' });
      session.devices.add(deviceId);
      session.votes += 1;
      return sendJson(res, 200, { message: '感谢投票', votes: session.votes });
    }

    if (req.method === 'GET') return serveFile(res, url.pathname);
    sendJson(res, 404, { error: '接口不存在' });
  } catch (error) {
    sendJson(res, 500, { error: '服务器错误', detail: error.message });
  }
});

function urlBase(req) {
  const host = req.headers.host || `localhost:${port}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  return `${protocol}://${host}`;
}

server.listen(port, () => {
  console.log(`Vote system running at http://localhost:${port}`);
});