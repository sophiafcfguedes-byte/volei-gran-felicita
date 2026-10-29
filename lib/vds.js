// Busca as reservas da Quadra de Esportes no Vida de Síndico (site do condomínio).
// Entra com o login guardado em ~/.volei-vds.json (só na máquina, nunca no GitHub):
//   { "user": "...", "pass": "...", "recurso": "OuJM5bOP2AdZkWe6PL7X7g==" }
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = process.env.VDS_CONFIG || path.join(os.homedir(), '.volei-vds.json');
const SITE = 'https://www.granfelicitacastelo.com.br/arearestrita';
const APP = 'https://app.vidadesindico.com.br';
const DEFAULT_RECURSO = 'OuJM5bOP2AdZkWe6PL7X7g=='; // Quadra de Esportes
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { return null; }
}

// Pote de cookies simples, por domínio.
function jar() {
  const list = [];
  return {
    store(url, res) {
      const host = new URL(url).hostname;
      const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
      for (const c of raw) {
        const [pair, ...attrs] = c.split(';');
        const i = pair.indexOf('=');
        if (i < 1) continue;
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        const dom = (attrs.map(a => a.trim()).find(a => /^domain=/i.test(a)) || '').replace(/^domain=\.?/i, '').toLowerCase() || host;
        const k = list.findIndex(x => x.name === name && x.dom === dom);
        if (k >= 0) list.splice(k, 1);
        if (value) list.push({ name, value, dom });
      }
    },
    header(url) {
      const host = new URL(url).hostname;
      return list.filter(x => host === x.dom || host.endsWith('.' + x.dom)).map(x => x.name + '=' + x.value).join('; ');
    }
  };
}

async function go(j, url, opts = {}, hops = 0) {
  const headers = Object.assign({ 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, opts.headers || {});
  const ck = j.header(url);
  if (ck) headers.Cookie = ck;
  const res = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers, redirect: 'manual' });
  j.store(url, res);
  const loc = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && loc && hops < 12) return go(j, new URL(loc, url).href, {}, hops + 1);
  const text = await res.text();
  // Redirecionamento por script/meta (comum nesses sites ASP.NET).
  const m = text.length < 20000 && (text.match(/location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) || text.match(/http-equiv=["']refresh["'][^>]*url=([^"'>]+)/i));
  if (m && hops < 12 && !/__VIEWSTATE/.test(text)) return go(j, new URL(m[1].replace(/&amp;/g, '&'), url).href, {}, hops + 1);
  return { url, status: res.status, text };
}

function hiddenFields(html) {
  const out = {};
  for (const m of html.matchAll(/<input[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name="([^"]+)"/) || [])[1];
    if (!name) continue;
    if (!/type="hidden"/i.test(tag)) continue;
    out[name] = ((tag.match(/value="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return out;
}

async function login(cfg) {
  const j = jar();
  const page = await go(j, SITE);
  const action = (page.text.match(/<form[^>]*action="([^"]+)"/i) || [])[1];
  if (!action) throw new Error('não achei o formulário de login (' + page.status + ')');
  const form = hiddenFields(page.text);
  const user = Object.keys(form).length && (page.text.match(/name="([^"]*txtUsuario)"/) || [])[1];
  const pass = (page.text.match(/name="([^"]*txtSenha)"/) || [])[1];
  const btn = (page.text.match(/__doPostBack\('([^']*lnkAcesso)'/) || [])[1];
  if (!user || !pass || !btn) throw new Error('o formulário de login mudou');
  Object.assign(form, { __EVENTTARGET: btn, __EVENTARGUMENT: '', [user]: cfg.user, [pass]: cfg.pass });
  const after = await go(j, new URL(action.replace(/&amp;/g, '&'), page.url).href, {
    method: 'POST', body: new URLSearchParams(form).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: page.url, Origin: new URL(page.url).origin }
  });
  if (/txtSenha/.test(after.text) && !/vidadesindico/.test(after.url)) throw new Error('login recusado (confira usuário e senha)');
  await go(j, APP + '/app/cond.aspx?p=t');
  return j;
}

let session = null;
async function fetchReservas(cfg, now = Date.now()) {
  const recurso = cfg.recurso || DEFAULT_RECURSO;
  const start = Math.floor(now / 1000) - 86400, end = start + 45 * 86400;
  const url = `${APP}/app/control/colaboracao/ReservaLista.aspx?origem=w&mes=5&recurso=${encodeURIComponent(recurso)}&start=${start}&end=${end}&_=${now}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session) session = await login(cfg);
    const r = await go(session, url, { headers: { Accept: 'application/json, text/javascript, */*', 'X-Requested-With': 'XMLHttpRequest', Referer: APP + '/app/cond.aspx?p=t' } });
    const t = r.text.trim();
    if (t.startsWith('[')) {
      return JSON.parse(t).map(e => ({ title: String(e.title || ''), start: String(e.start || ''), end: String(e.end || '') }));
    }
    session = null; // sessão caiu: entra de novo
  }
  throw new Error('não consegui ler as reservas depois de entrar');
}

module.exports = { readConfig, fetchReservas, CONFIG };
