// Liga o robô só quando há aviso pra mandar (lista completa, alguém subiu da espera, vagas das 13h, times das 17h)
// e desliga uns minutos depois. Assim o seu WhatsApp volta a notificar no resto do tempo.
// Roda a cada minuto pelo cron (instalado por scripts/bot-demanda-setup.sh).
const fs = require('fs'), os = require('os'), path = require('path');
const { execSync } = require('child_process');
const STATE = path.join(os.homedir(), 'volei-bot-v2', 'state.json');
const MARK = path.join(os.homedir(), '.bot-demanda.json');
const sh = c => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };
const log = m => console.log(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' | ' + m);
(async () => {
  let data;
  try { data = await (await fetch('http://localhost:3077/api/avisos')).json(); } catch (e) { return; }
  let sent = {};
  try { sent = (JSON.parse(fs.readFileSync(STATE, 'utf8')).avisos) || {}; } catch (e) {}
  const pend = [];
  for (const g of data.games || []) {
    if (g.full && !sent[g.id]) pend.push(g.id);
    if (sent[g.id]) for (const p of g.promos || []) if (!sent[p.key]) pend.push(p.key);
    if (g.vagas && !sent[g.vagas.key]) pend.push(g.vagas.key);
    if (g.teams && !sent[g.teams.key]) pend.push(g.teams.key);
  }
  let mark = {}; try { mark = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch (e) {}
  const active = sh('systemctl is-active volei-bot') === 'active', now = Date.now();
  if (pend.length) {
    mark.busy = now;
    if (!active) { sh('sudo systemctl start volei-bot'); mark.started = now; log('Ligando o robô: ' + pend.join(', ')); }
  } else if (active && now - Math.max(mark.busy || 0, mark.started || 0) > 4 * 60e3) {
    sh('sudo systemctl stop volei-bot'); log('Nada pra mandar: robô desligado.');
  }
  fs.writeFileSync(MARK, JSON.stringify(mark));
})();
