// Acerta o saldo da caixinha. Uso: pm2 stop volei && node scripts/caixa-saldo.js 85,07 && pm2 start volei
const fs = require('fs'), path = require('path');
const file = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const v = Number(String(process.argv[2] || '').replace(',', '.'));
if (!Number.isFinite(v)) { console.log('❌ Valor inválido'); process.exit(1); }
s.caixa = s.caixa || {}; s.caixa.base = { valor: v, ts: Date.now() };
fs.writeFileSync(file, JSON.stringify(s));
console.log('✅ Saldo da caixinha: R$ ' + v.toFixed(2).replace('.', ','));
