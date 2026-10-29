/* Servidor do app do vôlei. Sem dependências: só Node 18+.
   Uso: ADMIN_PASSWORD=suaSenha PORT=3000 node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./public/logic.js');
const Auth = require('./lib/auth.js');
const VDS = require('./lib/vds.js');

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

/* A cada 30 min: busca as reservas da quadra no Vida de Síndico (se o login estiver configurado). */
async function syncReservas() {
  const cfg = VDS.readConfig();
  if (!cfg || !cfg.user || !cfg.pass) return;
  try {
    const list = await VDS.fetchReservas(cfg);
    state.reservas = { ts: Date.now(), ok: true, list };
  } catch (e) {
    state.reservas = Object.assign({}, state.reservas || { list: [] }, { ok: false, err: String(e.message || e).slice(0, 200), errTs: Date.now() });
    console.error('reservas:', e.message);
  }
  version = Date.now(); save();
}
setTimeout(syncReservas, 5000);
setInterval(syncReservas, 30 * 60000);

/* 17h (lista fechada): libera na portaria quem vai jogar e não mora no condomínio. Admin pode pedir na hora. */
let acessoBusy = false;
async function syncAcessos() {
  if (acessoBusy) return;
  const cfg = VDS.readConfig();
  if (!cfg || !cfg.user || !cfg.pass) return;
  const now = Date.now();
  state.acessos ||= {};
  const req = state.acessoReq;
  const todo = Object.values(state.games).filter(g => {
    const a = state.acessos[g.meta.id];
    if (req && req.game === g.meta.id && (!a || a.ts < req.ts)) return true;
    return g.frozen && now - g.meta.cutoffAt < 4 * 3600e3 && now < g.meta.startAt + 6 * 3600e3 && (!a || (!a.done && (a.tries || 0) < 3 && now - a.ts > 5 * 60e3));
  });
  if (!todo.length) return;
  acessoBusy = true;
  try {
    let existentes = null;
    try { existentes = await VDS.listarAutorizacoes(cfg); } catch (e) { existentes = []; console.error('acessos/lista:', e.message); }
    for (const g of todo) {
      const id = g.meta.id, d = L.derive(L.view(state, id)), pm = Object.fromEntries(state.players.map(p => [p.id, p]));
      const prev = state.acessos[id] || {};
      const items = [];
      for (const pid of d.confirmed) {
        const p = pm[pid];
        if (!p) continue;
        const it = { pid, name: p.name };
        if (p.morador) it.st = 'morador';
        else if (p.cadastrado) it.st = 'cadastrado';
        else if (p.guest && !p.cpf && (() => { const pr = (state.games[id].presences || []).find(x => x.pid === pid); return pr && pm[pr.by] && pm[pr.by].morador; })()) it.st = 'convmorador';
        else if (!p.cpf) it.st = 'semcpf';
        else {
          try { it.st = await VDS.garantirAcesso(cfg, { cpf: p.cpf, nome: p.fullName || p.name }, id, existentes); }
          catch (e) { it.st = 'erro'; it.msg = String(e.message || e).slice(0, 160); }
        }
        items.push(it);
      }
      const errs = items.filter(x => x.st === 'erro').length;
      state.acessos[id] = { ts: Date.now(), done: !errs, tries: (prev.tries || 0) + 1, items };
      console.log(`acessos ${id}: ` + items.map(x => x.name + '=' + x.st).join(', '));
    }
    if (req && todo.some(g => g.meta.id === req.game)) delete state.acessoReq;
  } catch (e) { console.error('acessos:', e.message); }
  finally { acessoBusy = false; version = Date.now(); save(); }
}
setInterval(() => syncAcessos().catch(e => console.error('acessos:', e.message)), 60000);

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
