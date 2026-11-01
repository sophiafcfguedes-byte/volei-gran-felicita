// Lê o comprovante da caixinha (foto ou PDF) e confere: data do mês atual, valor de R$ 5 e o nome da pessoa.
// Usa programas da máquina: tesseract (fotos) e pdftotext/pdftoppm (PDF). Sem eles, fica pendente pra um admin aprovar.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const run = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 60000, maxBuffer: 8e6 }, (err, out) => res(err ? '' : String(out || ''))));
const fold = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

async function lerTexto(file, ext) {
  if (ext === 'pdf') {
    let t = await run('pdftotext', ['-layout', file, '-']);
    if (t.trim().length > 20) return t;
    const base = path.join(os.tmpdir(), 'cx-' + Date.now());
    await run('pdftoppm', ['-png', '-r', '200', '-f', '1', '-l', '1', file, base]);
    const png = [base + '-1.png', base + '-01.png'].find(f => fs.existsSync(f));
    if (!png) return '';
    t = await run('tesseract', [png, '-', '-l', 'por']);
    try { fs.unlinkSync(png); } catch (e) {}
    return t;
  }
  return run('tesseract', [file, '-', '-l', 'por']);
}

/* Devolve { ok, faltou: [...] } — o que não foi encontrado no texto. */
function conferir(texto, { y, m, nome }) {
  const t = fold(texto).replace(/\s+/g, ' ');
  const faltou = [];
  const yy = String(y), y2 = yy.slice(2), mm = m + 1;
  const datas = [...t.matchAll(/\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})\b/g)].some(x => Number(x[2]) === mm && (x[3] === yy || x[3] === y2));
  const porExtenso = new RegExp(`\\b${MESES[m]}[a-z]*\\.?\\s*(de\\s*)?[\\/\\-]?\\s*(${yy}|${y2})\\b`).test(t);
  const iso = new RegExp(`\\b${yy}-0?${mm}-\\d{1,2}\\b`).test(t);
  if (!datas && !porExtenso && !iso) faltou.push('a data deste mês');
  if (!/(^|[^\d,.])(r\$\s*)?0*5[,.]00(?!\d)/.test(t) && !/r\$\s*5(?![\d,.])/.test(t)) faltou.push('o valor de R$ 5,00');
  const partes = fold(nome).split(/\s+/).filter(w => w.length >= 3);
  if (partes.length && !partes.some(w => t.includes(w))) faltou.push('o seu nome');
  return { ok: faltou.length === 0, faltou };
}

async function analisar(file, ext, info) {
  const texto = await lerTexto(file, ext);
  if (!texto.trim()) return { st: 'pendente', why: 'Não consegui ler o comprovante; um admin vai conferir.' };
  const r = conferir(texto, info);
  return r.ok ? { st: 'ok' } : { st: 'pendente', why: 'Não encontrei ' + r.faltou.join(', ') + '. Um admin vai conferir.' };
}

module.exports = { analisar, conferir };
