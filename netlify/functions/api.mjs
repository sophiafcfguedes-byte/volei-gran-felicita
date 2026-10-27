/* API do app no Netlify. Guarda a lista no Netlify Blobs (não precisa de banco de dados).
   Defina ADMIN_PASSWORD em: Site configuration → Environment variables. */
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import L from '../../public/logic.js';

const KEY = 'estado';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

async function load(store) {
  const r = await store.getWithMetadata(KEY, { type: 'json' });
  if (!r || !r.data) return { state: L.normalize(L.initialState(), Date.now()), etag: null };
  return { state: L.normalize(r.data, Date.now()), etag: r.etag || null };
}

export default async (req) => {
  const url = new URL(req.url);
  const pw = process.env.ADMIN_PASSWORD || '';
  const token = pw ? createHash('sha256').update('volei:' + pw).digest('hex') : null;
  const isAdmin = !!token && req.headers.get('x-admin-token') === token;
  const store = getStore({ name: 'volei', consistency: 'strong' });
  const payload = (state, extra) => Object.assign({}, extra, { version: state.updatedAt || 0, isAdmin, now: Date.now(), state: L.publicState(state, isAdmin) });

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const { state } = await load(store);
    return json(payload(state));
  }

  if (url.pathname === '/api/resumo' && req.method === 'GET') {
    const { state } = await load(store);
    const d = L.derive(state), pm = Object.fromEntries(state.players.map(p => [p.id, p]));
    const nm = id => pm[id].name + (pm[id].guest ? ' (C)' : '');
    const lines = [`🏐 ${L.gameTitle(state.current)} (${L.gameWhen(state.current)}) — ${d.confirmed.length}/${state.settings.max}`, ...d.confirmed.map((id, i) => `${i + 1}. ${nm(id)}`)];
    if (d.waitlist.length) lines.push('', 'Espera:', ...d.waitlist.map((id, i) => `${i + 1}. ${nm(id)}`));
    return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }

  if (url.pathname === '/api/action' && req.method === 'POST') {
    let a;
    try { a = await req.json(); } catch (e) { return json({ ok: false, error: 'Pedido inválido.' }, 400); }
    if (JSON.stringify(a).length > 1e6) return json({ ok: false, error: 'Pedido grande demais.' }, 400);

    if (a.type === 'login') {
      if (token && a.password === pw) return json({ ok: true, token });
      await new Promise(r => setTimeout(r, 800));
      return json({ ok: false, error: pw ? 'Senha incorreta.' : 'Falta configurar ADMIN_PASSWORD no Netlify.' });
    }

    /* Grava só se ninguém mudou a lista no meio do caminho; senão relê e tenta de novo. */
    for (let attempt = 0; attempt < 6; attempt++) {
      const { state, etag } = await load(store);
      const r = L.apply(state, a, { isAdmin, now: Date.now() });
      if (!r.ok) return json(payload(state, r));
      state.updatedAt = Date.now();
      const res = etag
        ? await store.setJSON(KEY, state, { onlyIfMatch: etag })
        : await store.setJSON(KEY, state, { onlyIfNew: true });
      if (!res || res.modified !== false) return json(payload(state, r));
      await new Promise(ok => setTimeout(ok, 60 + Math.random() * 140));
    }
    return json({ ok: false, error: 'Muita gente mexendo ao mesmo tempo. Tente de novo.' });
  }

  return json({ error: 'não encontrado' }, 404);
};

export const config = { path: ['/api/state', '/api/action', '/api/resumo'] };
