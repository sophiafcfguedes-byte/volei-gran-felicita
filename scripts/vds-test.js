// Testa o login no Vida de Síndico e mostra as próximas reservas da quadra.
const VDS = require('../lib/vds.js');
const cfg = VDS.readConfig();
if (!cfg) { console.log('Sem configuração em ' + VDS.CONFIG + '. Rode: bash scripts/vds-setup.sh'); process.exit(1); }
VDS.fetchReservas(cfg).then(list => {
  console.log('✅ Entrou e leu ' + list.length + ' reserva(s). Algumas:');
  for (const e of list.slice(0, 6)) console.log('  ' + e.start.replace('T', ' ').slice(0, 16) + '  ' + e.title);
}).catch(e => { console.log('❌ ' + e.message); process.exit(1); });
