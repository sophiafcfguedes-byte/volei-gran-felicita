// Devolve alguém à lista de um jogo (ex.: tirado por engano). Uso, com o app parado:
//   pm2 stop volei && node scripts/devolver-lista.js 2026-11-02 "Laura Gabaglia" && pm2 start volei
const fs = require('fs'), path = require('path');
const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const [gid, nome] = process.argv.slice(2);
const g = s.games[gid]; if (!g) { console.log('❌ Jogo não encontrado: ' + gid); process.exit(1); }
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const p = s.players.find(x => fold(x.name) === fold(nome)); if (!p) { console.log('❌ Não achei ' + nome); process.exit(1); }
if (!g.presences.some(x => x.pid === p.id)) g.presences.push({ pid: p.id, by: p.id, ts: g.meta.openAt });
s.bans = (s.bans || []).filter(b => !(b.pid === p.id && b.game === gid));
fs.writeFileSync(file, JSON.stringify(s));
console.log('✅ ' + p.name + ' voltou pra lista de ' + gid + (g.frozen && g.frozen.includes(p.id) ? ' (como confirmada)' : ''));
