// Testa a parte de portaria do Vida de Síndico.
//   node scripts/vds-acesso-test.js                      → só confere o acesso (não cria nada)
//   node scripts/vds-acesso-test.js CPF "Nome Completo" AAAA-MM-DD  → cria uma liberação de verdade
const VDS = require('../lib/vds.js');
const cfg = VDS.readConfig();
if (!cfg) { console.log('Sem configuração. Rode: bash scripts/vds-setup.sh'); process.exit(1); }
(async () => {
  const list = await VDS.listarAutorizacoes(cfg);
  console.log('✅ Entrou na API nova. Autorizações na sua unidade: ' + list.length);
  const [cpf, nome, dia] = process.argv.slice(2);
  if (!cpf) return;
  const r = await VDS.garantirAcesso(cfg, { cpf: cpf.replace(/\D/g, ''), nome }, dia, list);
  console.log(r === 'ja' ? 'ℹ️ Essa pessoa já tinha acesso nesse dia.' : '✅ Liberação criada para ' + nome + ' em ' + dia + '.');
})().catch(e => { console.log('❌ ' + e.message); process.exit(1); });
