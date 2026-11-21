// Investiga como o Vida de Síndico guarda autorizações "por lista" ligadas a reserva (só lê, não cria nada).
const V = require('../lib/vds.js');
(async () => {
  const cfg = V.readConfig();
  const cut = (o, n = 1500) => JSON.stringify(o).slice(0, n);
  const regs = await V.listarAutorizacoes(cfg);
  console.log('Autorizações:', regs.length);
  const lista = regs.filter(r => r.listaConvidados || r.reserva || r.permissaoReserva || /lista|reserva/i.test(JSON.stringify(Object.keys(r))));
  console.log('Com lista/reserva:', lista.length);
  for (const r of lista.slice(0, 3)) console.log('\n== EXEMPLO ==\n' + cut(r, 3000));
  if (regs[0]) console.log('\nCampos de uma autorização comum:', Object.keys(regs[0]).join(', '));
  const tok = await (async () => { try { return await V._api(cfg, 'GET', '/perfil'); } catch (e) { return null; } })();
  for (const rota of ['/reserva', '/reservas', '/reserva?page=1&limit=20', '/reservas/minhas', '/autorizacao_acesso/reservas', '/area_comum', '/areas_comuns']) {
    try { const d = await V._api(cfg, 'GET', rota); console.log('\nOK ' + rota + ' → ' + cut(d, 1200)); }
    catch (e) { console.log('x ' + rota + ' → ' + e.message.slice(0, 80)); }
  }
})().catch(e => console.log('Erro:', e.message));
