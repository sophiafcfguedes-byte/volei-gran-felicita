// Ajusta o robô do WhatsApp: desliga as enquetes automáticas e manda a lista
// do app no grupo principal assim que ela completa. Uso: node patch-bot.mjs /caminho/index.js
import fs from 'node:fs';
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
if (s.includes('const AVISOS = {')) { console.log('O robô já tem os avisos. Nada a fazer.'); process.exit(0); }
const edits = [
  ["const WAITLIST_OPTIONS = ['✅', '✅✅'];",
   `const WAITLIST_OPTIONS = ['✅', '✅✅'];
// Enquetes automáticas: desligadas (a lista agora é pelo app).
const POLLS_ENABLED = false;
// Avisos do app: manda a lista no grupo do jogo assim que ela completa (segunda/quinta → principal; quarta → volei quarta).
const AVISOS = { enabled: true, appUrl: 'http://localhost:3077', publicUrl: 'https://volei-gran-felicita.136-248-105-121.sslip.io' };`],
  ["for (const r of ROUNDS) state.rounds[r.id] ||= { lastScheduledKey: '', active: null };",
   `for (const r of ROUNDS) state.rounds[r.id] ||= { lastScheduledKey: '', active: null };
// Com as enquetes desligadas, rodadas que ficaram abertas são encerradas (sem lista de espera nem apagar nada).
if (!POLLS_ENABLED) for (const r of ROUNDS) { const c = state.rounds[r.id].active; if (c && !c.finished) c.finished = true; }`],
  ["      await startRound(r, { reason: `agendado (",
   "      if (!POLLS_ENABLED) continue;\n      await startRound(r, { reason: `agendado ("],
  ["setInterval(tick, 5_000);",
   `setInterval(tick, 5_000);

// ---------- avisos do app: lista completa ----------
async function avisosTick() {
  if (!connected || !AVISOS.enabled) return;
  let data;
  try { data = await (await fetch(AVISOS.appUrl + '/api/avisos')).json(); } catch (e) { return; }
  state.avisos ||= {};
  for (const g of data.games || []) {
    if (!g.full || state.avisos[g.id]) continue;
    const groupId = rt[g.group]?.groupId;
    if (!groupId) { logErr('Aviso: não achei o grupo de ' + g.group); continue; }
    state.avisos[g.id] = Date.now(); saveState();
    try {
      await sock.sendMessage(groupId, { text: g.text + (AVISOS.publicUrl ? '\\n' + AVISOS.publicUrl : '') });
      log('Aviso enviado: lista completa (' + g.id + ').');
    } catch (e) { delete state.avisos[g.id]; saveState(); logErr('Não consegui mandar o aviso:', e.message); }
  }
  for (const k of Object.keys(state.avisos)) if (Date.now() - state.avisos[k] > 10 * 864e5) delete state.avisos[k];
}
setInterval(() => avisosTick().catch((e) => logErr('avisos:', e.message)), 30_000);`],
];
for (const [a, b] of edits) {
  if (s.split(a).length !== 2) { console.error('Não reconheci este trecho do robô (versão diferente?): ' + a.slice(0, 60)); process.exit(1); }
  s = s.replace(a, () => b);
}
fs.writeFileSync(file, s);
console.log('Robô ajustado: enquetes desligadas, aviso de lista completa ligado.');
