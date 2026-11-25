/* Notificação no celular (Web Push) sem bibliotecas: push sem conteúdo + chave VAPID assinada aqui.
   O texto da notificação fica no service worker (public/sw.js). */
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const KEY_FILE = path.join(os.homedir(), '.volei-vapid.json'), SUB_FILE = path.join(os.homedir(), '.volei-push.json');
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function keys() {
  try { return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch (e) {}
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const k = { priv: privateKey.export({ format: 'pem', type: 'pkcs8' }), pub: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64'), Buffer.from(jwk.y, 'base64')])) };
  fs.writeFileSync(KEY_FILE, JSON.stringify(k), { mode: 0o600 });
  return k;
}
const subs = () => { try { return JSON.parse(fs.readFileSync(SUB_FILE, 'utf8')); } catch (e) { return []; } };
function addSub(sub, admin) {
  if (!sub || !/^https:\/\//.test(sub.endpoint || '')) return false;
  const old = subs().find(s => s.endpoint === sub.endpoint);
  const list = subs().filter(s => s.endpoint !== sub.endpoint); list.push({ endpoint: sub.endpoint, ts: Date.now(), admin: !!admin || !!(old && old.admin) });
  fs.writeFileSync(SUB_FILE, JSON.stringify(list)); return true;
}
function jwt(aud) {
  const k = keys();
  const h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), p = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:volei@granfelicita.app' }));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: k.priv, dsaEncoding: 'ieee-p1363' });
  return h + '.' + p + '.' + b64u(sig);
}
/* O push vai sem conteúdo; o celular busca o texto da última mensagem em /api/push/msg. */
let ultima = { title: 'Vôlei Gran Felicitá', body: 'Tem aprovação esperando por você: comprovante ou convidado.' };
async function notifyAll(msg, soAdmin = true) {
  if (msg) ultima = Object.assign({ title: 'Vôlei Gran Felicitá' }, msg);
  const k = keys(), list = subs().filter(s => !soAdmin || s.admin), dead = [];
  await Promise.all(list.map(async s => {
    try {
      const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', 'Content-Length': '0', Authorization: `vapid t=${jwt(new URL(s.endpoint).origin)}, k=${k.pub}` } });
      if (r.status === 404 || r.status === 410) dead.push(s.endpoint);
    } catch (e) {}
  }));
  if (dead.length) fs.writeFileSync(SUB_FILE, JSON.stringify(subs().filter(s => !dead.includes(s.endpoint))));
}
/* Quantas aprovações estão esperando: comprovantes (jogadores e convidados) e convidados da quarta. */
function pendentes(s) {
  let n = 0;
  for (const m of Object.values(s.pag || {})) for (const e of Object.values(m)) if (e && e.st === 'pendente') n++;
  for (const m of Object.values(s.pagGuests || {})) for (const e of Object.values(m)) if (e && e.st === 'pendente') n++;
  for (const g of Object.values(s.games || {})) n += (g.guestReq || []).length;
  return n;
}
module.exports = { publicKey: () => keys().pub, addSub, notifyAll, pendentes, ultima: () => ultima };
