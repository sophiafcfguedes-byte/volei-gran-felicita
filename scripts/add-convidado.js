// Coloca um convidado na lista de um jogo, como trazido por alguém. Uso, com o app parado:
//   pm2 stop volei && node scripts/add-convidado.js 2026-11-12 "Eduardo Magalhães" Michelle && pm2 start volei
const fs = require('fs'), path = require('path');
const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const [gid, nome, quem] = process.argv.slice(2);
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const g = s.games[gid]; if (!g) { console.log('❌ Jogo não encontrado: ' + gid); process.exit(1); }
const by = s.players.filter(x => !x.guest).find(x => fold(x.name).startsWith(fold(quem)) || fold(x.fullName).startsWith(fold(quem)));
if (!by) { console.log('❌ Não achei quem trouxe: ' + quem); process.exit(1); }
let p = s.players.find(x => fold(x.name) === fold(nome));
if (!p) { p = { id: 'c' + Date.now().toString(36), name: nome, skill: 2.5, guest: true, fixed: false, priv: false, photo: null, freq: 0, cpf: '', fullName: '' }; s.players.push(p); }
if (!g.presences.some(x => x.pid === p.id)) g.presences.push({ pid: p.id, by: by.id, ts: Date.now(), asGuest: !p.guest });
(g.log ||= []).unshift({ ts: Date.now(), by: null, act: 'add', pid: p.id, name: p.name, byName: 'admin' });
fs.writeFileSync(file, JSON.stringify(s));
const pos = g.presences.findIndex(x => x.pid === p.id) + 1;
console.log(`✅ ${p.name} entrou na lista de ${gid} como convidado de ${by.name} (posição ${pos} de ${g.presences.length})`);
