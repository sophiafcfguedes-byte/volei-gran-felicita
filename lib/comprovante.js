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
    t = await ocr(png);
    try { fs.unlinkSync(png); } catch (e) {}
    return t;
  }
  return ocr(file);
}
async function ocr(file) { return (await run('tesseract', [file, '-', '-l', 'por'])) || run('tesseract', [file, '-']); }

/* Valor do Pix: o número logo depois de "valor", senão o maior "R$ x,xx" do comprovante (até R$ 1.000). */
function lerValor(t) {
  const num = x => Number(x.replace(/\./g, '').replace(',', '.'));
  const m = t.match(/valor[^\d]{0,25}?(\d{1,4}(?:\.\d{3})*,\d{2})/);
  if (m) return num(m[1]);
  const all = [...t.matchAll(/r\$\s*(\d{1,4}(?:\.\d{3})*(?:,\d{2})?)/g)].map(x => num(x[1])).filter(v => v > 0 && v <= 1000);
  return all.length ? Math.max(...all) : NaN;
}

/* Devolve { ok, faltou: [...] } — o que não foi encontrado no texto. */
function conferir(texto, { y, m, nome, cpf }) {
  const t = fold(texto).replace(/\s+/g, ' ');
  const faltou = [];
  const yy = String(y), y2 = yy.slice(2), mm = m + 1;
  const datas = [...t.matchAll(/\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})\b/g)].some(x => Number(x[2]) === mm && (x[3] === yy || x[3] === y2));
  const porExtenso = new RegExp(`\\b${MESES[m]}[a-z]*\\.?\\s*(de\\s*)?[\\/\\-]?\\s*(${yy}|${y2})\\b`).test(t);
  const iso = new RegExp(`\\b${yy}-0?${mm}-\\d{1,2}\\b`).test(t);
  if (!datas && !porExtenso && !iso) faltou.push('a data deste mês');
  const valor = lerValor(t);
  if (!(valor >= 5)) faltou.push('o valor (mínimo R$ 5,00)');
  /* nome pode ser uma lista (ex.: convidado e quem convidou): basta bater um deles. */
  const nomes = (Array.isArray(nome) ? nome : [nome]).filter(Boolean);
  /* Nome: aceita pequenos erros de leitura (1–2 letras trocadas), já que a foto do comprovante nem sempre sai perfeita. */
  const palavras = t.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const dist = (a, b) => { const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9; const d = Array.from({ length: m + 1 }, (_, i) => [i]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };
  const parecida = w => t.includes(w) || palavras.some(x => dist(x, w) <= (w.length >= 6 ? 2 : 1));
  const bate = n => { const partes = fold(n).split(/\s+/).filter(w => w.length >= 3); return !partes.length || partes.some(parecida); };
  /* CPF da pessoa (os comprovantes costumam mostrar os 6 do meio: ***.456.789-**) também confirma. */
  const digitos = texto.replace(/\D/g, '');
  const cpfBate = (Array.isArray(cpf) ? cpf : [cpf]).filter(c => c && c.length === 11).some(c => digitos.includes(c.slice(3, 9)));
  if (nomes.length && !nomes.some(bate) && !cpfBate) faltou.push(nomes.length > 1 ? 'o nome do convidado ou de quem convidou' : 'o seu nome');
  return { ok: faltou.length === 0, faltou, valor };
}

async function analisar(file, ext, info) {
  const texto = await lerTexto(file, ext);
  if (!texto.trim()) return { st: 'pendente', why: 'Não consegui ler o comprovante; um admin vai conferir.' };
  const r = conferir(texto, info);
  return r.ok ? { st: 'ok', valor: r.valor } : { st: 'pendente', valor: r.valor, why: 'Não encontrei ' + r.faltou.join(', ') + '. Um admin vai conferir.' };
}

module.exports = { analisar, conferir };
