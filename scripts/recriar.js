// Recria um jogador excluído com o mesmo ID (mantém histórico ligado a ele). Uso, com o app parado:
//   pm2 stop volei && node scripts/recriar.js p7t2mg "Elisa" && pm2 start volei
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const [id, name] = process.argv.slice(2);
if (s.players.some(p => p.id === id)) { console.log('Já existe.'); process.exit(0); }
s.players.push({ id, name, gender: '', skill: 2.5, paid: false, guest: false, fixed: false, priv: false, photo: null, freq: 0 });
fs.writeFileSync(file, JSON.stringify(s));
console.log('✅ ' + name + ' recadastrada (ID ' + id + ')');
