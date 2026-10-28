/* Servidor do app do vôlei. Sem dependências: só Node 18+.
   Uso: ADMIN_PASSWORD=suaSenha PORT=3000 node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./public/logic.js');
const Auth = require('./lib/auth.js');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

if (!ADMIN_PASSWORD) console.warn('⚠️  Defina ADMIN_PASSWORD, senão ninguém consegue entrar como admin.');

let state = L.initialState();
try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* primeiro uso */ }
L.normalize(state, Date.now());
let version = Date.now();

let lastSaved = '';
function save() {
  const json = JSON.stringify(state);
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, DATA_FILE);
  lastSaved = json;
}
/* A cada 20 s: fecha listas às 17h, sorteia os times e vira o jogo, mesmo sem ninguém abrir o app. */
setInterval(() => {
  try {
    L.normalize(state, Date.now());
    if (JSON.stringify(state) !== lastSaved) { version = Date.now(); save(); }
  } catch (e) { console.error('normalize', e); }
}, 20000);

const SECRET = 'gf-auth:' + ADMIN_PASSWORD;
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
      L.normalize(state, Date.now());
      const asked = url.searchParams.get('me');
      const me = Auth.who(state, SECRET, asked, url.searchParams.get('auth')) || (adm ? asked : null);
      return send(res, 200, { meOk: !asked || !!me, version: version + ':' + (me || ''), isAdmin: adm, now: Date.now(), state: L.publicState(state, adm, me) });
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const a = await readBody(req);
      if (a.type === 'login') {
        if (adminToken && a.password === ADMIN_PASSWORD) return send(res, 200, { ok: true, token: adminToken });
        await new Promise(r => setTimeout(r, 800));
        return send(res, 200, { ok: false, error: 'Senha incorreta.' });
      }
      const adm = isAdmin(req);
      if (a.type !== 'loginPlayer' && a.by && !adm && !Auth.who(state, SECRET, a.by, a.auth))
        return send(res, 200, { ok: false, authFail: true, error: 'Entre de novo com sua senha.', version, isAdmin: adm, now: Date.now(), state: L.publicState(state, adm, null) });
      const r = L.apply(state, a, { isAdmin: adm, now: Date.now() });
      if (r.ok && a.type === 'loginPlayer') r.auth = Auth.token(SECRET, r.pid, state.players.find(x => x.id === r.pid).pin);
      const meId = r.ok && a.type === 'loginPlayer' ? r.pid : (r.ok ? a.by : a.by);
      if (r.ok || a.type === 'loginPlayer') { version = Date.now(); save(); }
      return send(res, 200, Object.assign(r, { version: version + ':' + (meId || ''), isAdmin: adm, now: Date.now(), state: L.publicState(state, adm, meId) }));
    }
    /* Resumo em texto — útil para o robô do WhatsApp mandar no grupo. */
    if (url.pathname === '/api/avisos' && req.method === 'GET') {
      /* Só para o robô, na própria máquina: quem vem de fora passa pelo Caddy, que manda X-Forwarded-For. */
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
      if (!local) return send(res, 404, { error: 'não encontrado' });
      L.normalize(state, Date.now());
      return send(res, 200, L.avisos(state));
    }
    if (url.pathname === '/api/resumo' && req.method === 'GET') {
      L.normalize(state, Date.now());
      return send(res, 200, L.resumo(state), 'text/plain; charset=utf-8');
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'método não permitido' });
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'proibido', 'text/plain');
    fs.readFile(file, (err, buf) => err ? send(res, 404, 'não encontrado', 'text/plain') : send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream'));
  } catch (e) {
    send(res, 400, { ok: false, error: 'Pedido inválido.' });
  }
}).listen(PORT, () => console.log(`🏐 App do vôlei rodando em http://localhost:${PORT}`));
