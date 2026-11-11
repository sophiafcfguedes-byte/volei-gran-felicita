// Muda o horário em que a lista fecha, só para um jogo. Uso (com o app parado):
//   pm2 stop volei && node scripts/abrir-ate.js 2026-11-11 18:00 && pm2 start volei
const fs = require('fs'), path = require('path');
const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const [id, hora] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(id || '') || !/^\d{2}:\d{2}$/.test(hora || '')) { console.log('Uso: node scripts/abrir-ate.js AAAA-MM-DD HH:MM'); process.exit(1); }
s.cutoffOverride = Object.assign({}, s.cutoffOverride, { [id]: hora });
for (const k of Object.keys(s.cutoffOverride)) if (k < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)) delete s.cutoffOverride[k];
fs.writeFileSync(file, JSON.stringify(s));
console.log('✅ Lista de ' + id.split('-').reverse().join('/') + ' aberta até as ' + hora + '.');
