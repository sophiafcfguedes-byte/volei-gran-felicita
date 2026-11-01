// Liga a vaquinha e define o mês em que ela desliga, pelo nome. Uso:
//   pm2 stop volei && node scripts/vaquinha-ate.js "mercia=2027-01" "ju=2027-10" && pm2 start volei
const fs = require('fs'), path = require('path');
const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
let changed = 0;
for (const arg of process.argv.slice(2)) {
  const [nome, mes] = arg.split('=');
  const q = fold(nome);
  const exatos = s.players.filter(p => !p.guest && fold(p.name) === q);
  const hits = exatos.length ? exatos : s.players.filter(p => !p.guest && fold(p.name).split(' ')[0] === q);
  if (hits.length !== 1) { console.log(`⚠️  "${nome}": ${hits.length ? 'mais de uma pessoa (' + hits.map(p => p.name).join(', ') + ')' : 'ninguém com esse nome'} — ajuste no app.`); continue; }
  hits[0].caixinha = true; hits[0].caixinhaAte = mes; changed++;
  console.log(`✅ ${hits[0].name}: vaquinha ligada, desliga em ${mes.split('-').reverse().join('/')}`);
}
if (changed) fs.writeFileSync(file, JSON.stringify(s));
