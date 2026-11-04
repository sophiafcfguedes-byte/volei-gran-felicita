// Ajusta o robô do WhatsApp: desliga as enquetes automáticas e manda a lista do app
// no grupo do jogo quando ela completa; se alguém sobe da espera, manda a lista de novo
// com @pessoa e apaga a anterior. Uso: node patch-bot.mjs /caminho/index.js
// Pode rodar de novo: troca o bloco de avisos pela versão mais nova.
import fs from 'node:fs';
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');

const BLOCK = `// ---------- avisos do app (início) ----------
// Acha o WhatsApp da pessoa: celular cadastrado no app; senão o contato salvo no WhatsApp do robô.
// Contato bate se o nome salvo for igual ao do app, ou começar por ele, ou tiver todas as palavras dele
// (ex.: app "Ana Souza", contato "Ana Souza Vôlei"). Se bater mais de um contato, não arrisca.
function jidFor(p) {
  if (p.phone) return p.phone + '@s.whatsapp.net';
  const words = (v) => simplify(v).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const want = words(p.fullName || p.name), short = words(p.name);
  const score = (nm) => {
    const w = words(nm);
    if (!w.length) return 0;
    const j = w.join(' ');
    if (j === want.join(' ') || j === short.join(' ')) return 3;
    if (want.length > 1 && want.every((x) => w.includes(x))) return 2;
    if (short.length > 1 && short.every((x) => w.includes(x))) return 2;
    if (short.length === 1 && w[0] === short[0]) return 1;
    return 0;
  };
  let best = 0, hits = [];
  for (const [id, c] of Object.entries(contacts)) {
    const sc = Math.max(score(c.saved), score(c.push) >= 3 ? 3 : 0);
    if (!sc) continue;
    const phone = [id, ...(c.alt || [])].find((j) => String(j).endsWith('@s.whatsapp.net')) || id;
    if (sc > best) { best = sc; hits = [phone]; } else if (sc === best && !hits.includes(phone)) hits.push(phone);
  }
  return hits.length === 1 ? hits[0] : null;
}
// Troca "N. Nome" por "N. @pessoa" na lista. Convidado: marca quem trouxe ao lado.
function tagLine(text, pr, mentions) {
  const target = pr.guest && pr.by ? pr.by : pr;
  const jid = jidFor(target);
  if (jid) mentions.push(jid);
  const tag = jid ? '@' + jid.split('@')[0] : '@' + target.name;
  const shown = pr.by ? pr.name + ' (' + pr.by.name + ')' : pr.name;
  const esc = shown.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  const re = new RegExp('^(\\\\d+\\\\. )' + esc + '$', 'm');
  const repl = pr.guest && pr.by ? '$1' + pr.name + ' (' + tag + ')' : '$1' + tag;
  return re.test(text) ? text.replace(re, repl) : text;
}
async function avisosTick() {
  if (!connected || !AVISOS.enabled) return;
  let data;
  try { data = await (await fetch(AVISOS.appUrl + '/api/avisos')).json(); } catch (e) { return; }
  const plain = (o) => o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Array.isArray(o);
  if (!plain(state.avisos)) state.avisos = {};
  if (!plain(state.avisoMsgs)) state.avisoMsgs = {};
  // Quem já foi marcado em cada jogo (por pessoa): nunca marca a mesma pessoa duas vezes no mesmo jogo.
  if (!plain(state.tagged)) state.tagged = {};
  for (const g of data.games || []) {
    const groupId = rt[g.group]?.groupId;
    if (!groupId) continue;
    const newPromos = (g.promos || []).filter((p) => !state.avisos[p.key]);
    const firstTime = g.full && !state.avisos[g.id];
    const resend = newPromos.length && state.avisoMsgs[g.id];
    if (!firstTime && !resend) {
      for (const p of newPromos) state.avisos[p.key] = Date.now(); // lista ainda não foi pro grupo: nada a refazer
      if (newPromos.length) saveState();
      continue;
    }
    const mentions = [];
    let text = g.text;
    const tg = (state.tagged[g.id] ||= {});
    // Quem já teve aviso enviado antes (versões antigas) conta como marcado.
    for (const p of g.promos || []) if (state.avisos[p.key] && !newPromos.includes(p)) tg[p.pid] = 1;
    for (const p of newPromos) { if (p.again || tg[p.pid]) continue; text = tagLine(text, p, mentions); tg[p.pid] = 1; }
    if (AVISOS.publicUrl) text += '\\n' + AVISOS.publicUrl;
    state.avisos[g.id] = Date.now();
    for (const p of newPromos) state.avisos[p.key] = Date.now();
    saveState();
    try {
      const sent = await sock.sendMessage(groupId, { text, mentions });
      const old = state.avisoMsgs[g.id];
      state.avisoMsgs[g.id] = sent.key; saveState();
      log((resend ? 'Lista reenviada (subiu da espera)' : 'Lista completa enviada') + ' (' + g.id + ').');
      if (old) { await wait(1500); try { await sock.sendMessage(groupId, { delete: old }); } catch (e) { logErr('Não consegui apagar a lista anterior:', e.message); } }
    } catch (e) { logErr('Não consegui mandar a lista:', e.message); }
  }
  // Quarta sem 12 pessoas às 17h: "@all vôlei cancelado" no grupo da quarta (uma vez).
  for (const g of data.games || []) {
    const groupId = rt[g.group]?.groupId;
    if (!groupId || !g.cancel || state.avisos[g.cancel.key]) continue;
    state.avisos[g.cancel.key] = Date.now(); saveState();
    try {
      await sock.sendMessage(groupId, { text: '@all ' + g.cancel.text + (g.cancel.title ? '\\n\\n' + g.cancel.title : ''), mentionAll: true, contextInfo: { nonJidMentions: 1 } });
      try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
      log('Aviso de cancelamento enviado (' + g.id + ').');
    } catch (e) { logErr('Não consegui mandar o cancelamento:', e.message); }
  }
  // 13h de segunda/quinta com vaga sobrando: "@todos faltam X vagas", marcando todo mundo do grupo.
  for (const g of data.games || []) {
    const groupId = rt[g.group]?.groupId;
    if (!groupId || !g.vagas || state.avisos[g.vagas.key]) continue;
    state.avisos[g.vagas.key] = Date.now(); saveState();
    try {
      // @all nativo do WhatsApp (o "@todos" verde): mentionAll no Baileys novo = contextInfo.nonJidMentions = 1.
      let text = '@all ' + g.vagas.text;
      if (AVISOS.publicUrl) text += '\\n' + AVISOS.publicUrl;
      await sock.sendMessage(groupId, { text, mentionAll: true, contextInfo: { nonJidMentions: 1 } });
      try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}
      log('Aviso de vagas enviado (' + g.id + ').');
    } catch (e) { logErr('Não consegui mandar o aviso de vagas:', e.message); }
  }
  // Times sorteados às 17h: manda uma vez no grupo do jogo.
  for (const g of data.games || []) {
    const groupId = rt[g.group]?.groupId;
    if (!groupId || !g.teams || state.avisos[g.teams.key]) continue;
    state.avisos[g.teams.key] = Date.now(); saveState();
    try { await sock.sendMessage(groupId, { text: g.teams.text }); try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {} log('Times enviados (' + g.id + ').'); }
    catch (e) { logErr('Não consegui mandar os times:', e.message); }
  }
  for (const k of Object.keys(state.avisos)) if (Date.now() - state.avisos[k] > 10 * 864e5) { delete state.avisos[k]; delete state.avisoMsgs[k]; delete state.tagged[k]; }
}
setInterval(() => avisosTick().catch((e) => logErr('avisos:', e.message)), 30_000);
// ---------- avisos do app (fim) ----------`;

// Enquetes removidas de vez: startRound não faz nada e o log não anuncia envio automático.
// Robô "offline": sem isso o WhatsApp acha que você está usando o computador e para de notificar o celular.
function presenceOff() {
  const m = "      myJid = normJid(sock.user?.id);";
  const add = "\n      try { await sock.sendPresenceUpdate('unavailable'); } catch (e) {}";
  if (s.includes(m) && !s.includes(m + add)) s = s.replace(m, () => m + add);
}
function killPolls() {
  presenceOff();
  const head = "async function startRound(round, { test = false, reason = 'agendado' } = {}) {";
  const guard = "\n  if (!POLLS_ENABLED) { log('Enquetes desligadas: a lista é pelo app.'); return; }";
  if (s.includes(head) && !s.includes(head + guard)) s = s.replace(head, () => head + guard);
  s = s.replace(/Envio automático: \$\{Object\.keys\(r\.sendDays\)[^`]*?\(somente nesse minuto\)\./, 'Enquetes desligadas (lista pelo app).');
}

// Já ajustado antes: troca o bloco antigo pelo novo.
if (s.includes('const AVISOS = {')) {
  const start = s.indexOf('// ---------- avisos do app');
  const endMark = s.indexOf('// ---------- avisos do app (fim) ----------');
  let end;
  if (endMark >= 0) end = endMark + '// ---------- avisos do app (fim) ----------'.length;
  else { const i = s.indexOf('setInterval(() => avisosTick()'); end = i < 0 ? -1 : s.indexOf('\n', i); }
  if (start < 0 || end < 0) { console.error('Não reconheci o bloco de avisos do robô.'); process.exit(1); }
  s = s.slice(0, start) + BLOCK + s.slice(end);
  killPolls();
  fs.writeFileSync(file, s);
  console.log('Robô atualizado: avisos na versão nova.');
  process.exit(0);
}

const edits = [
  ["const WAITLIST_OPTIONS = ['✅', '✅✅'];",
   `const WAITLIST_OPTIONS = ['✅', '✅✅'];
// Enquetes automáticas: desligadas (a lista agora é pelo app).
const POLLS_ENABLED = false;
// Avisos do app: lista no grupo do jogo quando completa (segunda/quinta → principal; quarta → volei quarta).
const AVISOS = { enabled: true, appUrl: 'http://localhost:3077', publicUrl: 'https://volei-gran-felicita.136-248-105-121.sslip.io' };`],
  ["for (const r of ROUNDS) state.rounds[r.id] ||= { lastScheduledKey: '', active: null };",
   `for (const r of ROUNDS) state.rounds[r.id] ||= { lastScheduledKey: '', active: null };
// Com as enquetes desligadas, rodadas que ficaram abertas são encerradas (sem lista de espera nem apagar nada).
if (!POLLS_ENABLED) for (const r of ROUNDS) { const c = state.rounds[r.id].active; if (c && !c.finished) c.finished = true; }`],
  ["      await startRound(r, { reason: `agendado (",
   "      if (!POLLS_ENABLED) continue;\n      await startRound(r, { reason: `agendado ("],
  ["setInterval(tick, 5_000);", "setInterval(tick, 5_000);\n\n" + BLOCK],
];
for (const [a, b] of edits) {
  if (s.split(a).length !== 2) { console.error('Não reconheci este trecho do robô (versão diferente?): ' + a.slice(0, 60)); process.exit(1); }
  s = s.replace(a, () => b);
}
killPolls();
fs.writeFileSync(file, s);
console.log('Robô ajustado: enquetes desligadas, avisos de lista ligados.');
