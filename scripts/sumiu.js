// Descobre o que houve com um jogador que sumiu: node scripts/sumiu.js elisa
const fs = require('fs'), path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const q = fold(process.argv[2] || ''), f = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const vivos = new Map(s.players.map(p => [p.id, p]));
const ids = new Set();
for (const g of Object.values(s.games || {})) for (const l of g.log || []) if (fold(l.name).includes(q)) ids.add(l.pid);
for (const h of s.history || []) (h.names || []).forEach((n, i) => { if (fold(n).includes(q)) ids.add(h.confirmed[i]); });
for (const p of s.players) if (fold(p.name + ' ' + (p.fullName || '')).includes(q)) ids.add(p.id);
for (const a of s.audit || []) if (fold(a.name + ' ' + (a.antes || '')).includes(q)) console.log(f(a.ts), a.act, a.antes ? a.antes + ' → ' + a.name : a.name);
if (!ids.size) console.log('Nunca encontrei esse nome no histórico.');
for (const id of ids) {
  const p = vivos.get(id);
  console.log(`\nID ${id}: ` + (p ? `EXISTE hoje como "${p.name}"${p.guest ? ' (convidado)' : ''}` : 'NÃO existe mais no cadastro (foi excluído)'));
  const ult = Object.values(s.games || {}).flatMap(g => (g.log || []).filter(l => l.pid === id).map(l => ({ ...l, g: g.meta.id }))).sort((a, b) => b.ts - a.ts)[0];
  if (ult) console.log('  último registro:', f(ult.ts), ult.act === 'add' ? 'entrou' : 'saiu', 'no jogo', ult.g, '— por', ult.byName || 'admin', '— nome na época:', ult.name);
  for (const [mk, m] of Object.entries(s.pag || {})) if (m[id]) console.log('  comprovante', mk + ':', m[id].st);
}
