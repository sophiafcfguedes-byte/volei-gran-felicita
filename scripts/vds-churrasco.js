// Libera no Vida de Síndico (por lista, na reserva da Churrasqueira 2 de hoje) todos os nomes da aba Churrasco.
const fs = require('fs'), path = require('path');
const V = require('../lib/vds.js');
(async () => {
  const cfg = V.readConfig(), api = (m, r, b) => V._api(cfg, m, r, b);
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  const nomes = [...new Set(Object.values((s.churras || {}).conf || {}).flatMap(c => [c.nome, ...(c.convidados || [])]).map(n => String(n).trim()).filter(Boolean))];
  console.log('Nomes na aba Churrasco:', nomes.length);
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  let res = null;
  for (let page = 1; page <= 20 && !res; page++) {
    const r = await api('GET', `/reserva?page=${page}&limit=50`);
    res = (r.regs || []).find(x => x.dtIni === hoje && /churrasqueira\s*0?2\b/i.test(x.recurso && x.recurso.nome || ''));
    if (!r.regs || r.regs.length < 50) break;
  }
  if (!res) return console.log('❌ Não achei reserva da Churrasqueira 2 pra hoje (' + hoje + ').');
  console.log('Reserva:', res.uuid, res.recurso.nome, res.data, res.horaIni, '| convidados:', res.qtdConvidados + '/' + res.qtdMaxConvidados);
  try { const d = await api('GET', '/reserva/' + res.uuid); console.log('Detalhe:', JSON.stringify(d).slice(0, 1500)); } catch (e) { console.log('detalhe:', e.message.slice(0, 100)); }
  const perfil = await api('GET', '/perfil'), u = perfil.usuario || {}, c = perfil.condominio || {};
  const unidade = (u.unidades || [])[0];
  const body = {
    tipo: 0,
    destino: { unidade: { uuid: typeof unidade === 'string' ? unidade : unidade.uuid }, morador: { uuid: u.moradorUuid }, interfonar: c.interfonar ? false : null },
    pessoas: nomes.map(nome => ({ nome, email: '', tipo: { uuid: '49', nome: 'Visitante' }, documento: { tipo: 'cpf', documento: '', estado: '' }, veiculo: { marcaModelo: '', placa: '', cor: '' }, reservarVaga: false })),
    periodos: [{ uuid: '', dtHoraIni: `${hoje}T00:00:00`, dtHoraFim: `${hoje}T23:59:00`, horaIni: '00:00', horaFim: '23:59', domingo: true, segunda: true, terca: true, quarta: true, quinta: true, sexta: true, sabado: true }],
    listaConvidados: true, reserva: { uuid: res.uuid }, nomeEvento: 'Churrasco', observacao: 'Churrasco', visitanteQR: c.visitanteQR, isAdmin: !!u.isAdmin, permissaoReserva: true
  };
  try { const r = await api('POST', '/autorizacao_acesso', body); console.log('✅ Enviado:', JSON.stringify(r).slice(0, 400)); }
  catch (e) { console.log('❌ Recusado:', e.message.slice(0, 600)); }
})().catch(e => console.log('Erro:', e.message));
