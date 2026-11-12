// Coloca o CPF de alguém (jogador ou convidado). Uso, com o app parado:
//   pm2 stop volei && node scripts/set-cpf.js "Nome" 12345678900 && pm2 start volei
const fs = require('fs'), path = require('path');
const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const [nome, cpf] = process.argv.slice(2);
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const p = s.players.find(x => fold(x.name) === fold(nome)); if (!p) { console.log('❌ Não achei ' + nome); process.exit(1); }
p.cpf = String(cpf).replace(/\D/g, ''); if (!p.fullName) p.fullName = p.name;
fs.writeFileSync(file, JSON.stringify(s));
console.log('✅ CPF salvo para ' + p.name);
