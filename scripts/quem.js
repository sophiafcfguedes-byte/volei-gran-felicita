// Uso: node scripts/quem.js eduardo  → mostra o histórico dessa pessoa no jogo atual e nos recentes
const fs = require('fs'), path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
const q = (process.argv[2] || '').toLowerCase();
const f = d => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const ps = (s.players || []).filter(p => ((p.fullName || '') + ' ' + p.name).toLowerCase().includes(q));
for (const p of ps) console.log('Jogador:', p.id, p.name, p.fullName || '', p.guest ? '(convidado)' : '');
if (!ps.length) console.log('Nenhum jogador cadastrado com esse nome hoje.');
const ids = new Set(ps.map(p => p.id));
const bate = l => ids.has(l.pid) || ((l.name || '') + ' ' + (l.byName || '')).toLowerCase().includes(q) && ids.add(l.pid);
for (const [gid, g] of Object.entries(s.games || {}).slice(-4)) {
  console.log('\n== Jogo', gid);
  console.log('  na lista agora:', (g.presences || []).some(x => ids.has(x.pid)) ? 'SIM' : 'não');
  for (const l of (g.log || []).filter(bate)) console.log('  ', f(l.ts), l.act === 'add' ? 'ENTROU' : 'SAIU', l.name || l.pid, '— feito por', l.byName || 'admin');
  for (const l of (g.log || []).filter(l => /rename|name/i.test(l.act))) console.log('   renomeação:', f(l.ts), JSON.stringify(l));
}
for (const b of (s.bans || []).filter(b => ids.has(b.pid))) console.log('\nImpedido no jogo', b.game, b.manual ? '(punição do admin)' : '(desistiu depois das ' + b.cutoff + ')');
