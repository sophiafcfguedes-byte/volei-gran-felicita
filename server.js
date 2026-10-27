/* Servidor do app do vôlei. Sem dependências: só Node 18+.
   Uso: ADMIN_PASSWORD=suaSenha PORT=3000 node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./public/logic.js');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

if (!ADMIN_PASSWORD) console.warn('⚠️  Defina ADMIN_PASSWORD, senão ninguém consegue entrar como admin.');

let state = L.initialState();
try { state = Object.assign(L.initialState(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) { /* primeiro uso */ }
let version = Date.now();

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}

const adminToken = ADMIN_PASSWORD ? crypto.createHash('sha256').update('volei:' + ADMIN_PASSWORD).digest('hex') : null;
const isAdmin = req => !!adminToken && req.headers['x-admin-token'] === adminToken;

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new Error('grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const adm = isAdmin(req);
      return send(res, 200, { version, isAdmin: adm, now: Date.now(), state: L.publicState(state, adm) });
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const a = await readBody(req);
      if (a.type === 'login') {
        if (adminToken && a.password === ADMIN_PASSWORD) return send(res, 200, { ok: true, token: adminToken });
        await new Promise(r => setTimeout(r, 800));
        return send(res, 200, { ok: false, error: 'Senha incorreta.' });
      }
      const adm = isAdmin(req);
      const r = L.apply(state, a, { isAdmin: adm, now: Date.now() });
      if (r.ok) { version = Date.now(); save(); }
      return send(res, 200, Object.assign(r, { version, isAdmin: adm, now: Date.now(), state: L.publicState(state, adm) }));
    }
    /* Resumo em texto — útil para o robô do WhatsApp mandar no grupo. */
    if (url.pathname === '/api/resumo' && req.method === 'GET') {
      const d = L.derive(state), pm = Object.fromEntries(state.players.map(p => [p.id, p]));
      const nm = id => pm[id].name + (pm[id].guest ? ' (C)' : '');
      const lines = [`🏐 ${state.settings.title} — ${d.confirmed.length}/${state.settings.max}`, ...d.confirmed.map((id, i) => `${i + 1}. ${nm(id)}`)];
      if (d.waitlist.length) lines.push('', 'Espera:', ...d.waitlist.map((id, i) => `${i + 1}. ${nm(id)}`));
      return send(res, 200, lines.join('\n'), 'text/plain; charset=utf-8');
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'método não permitido' });
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'proibido', 'text/plain');
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'não encontrado', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream'));
  } catch (e) {
    send(res, 400, { ok: false, error: 'Pedido inválido.' });
  }
}).listen(PORT, () => console.log(`🏐 App do vôlei rodando em http://localhost:${PORT}`));
