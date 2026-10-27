/* Gera public/index.html (servidor) e dist/demo.html (demonstração num arquivo só).
   Rode depois de editar src/page.html:  node build.js */
const fs = require('fs');
const path = require('path');
const page = fs.readFileSync(path.join(__dirname, 'src/page.html'), 'utf8');
const logic = fs.readFileSync(path.join(__dirname, 'public/logic.js'), 'utf8');
const uri = (f, t) => 'data:' + t + ';base64,' + fs.readFileSync(path.join(__dirname, 'assets', f)).toString('base64');
const ASSETS = { BADGE: uri('badge.webp', 'image/webp'), GLIDE: uri('swallow-glide.webp', 'image/webp'), FRONT: uri('swallow-front.webp', 'image/webp'), ICON: uri('icon.png', 'image/png') };
const fill = html => html.replace(/\{\{(BADGE|GLIDE|FRONT|ICON)\}\}/g, (m, k) => ASSETS[k]);

const head = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
fs.writeFileSync(path.join(__dirname, 'public/index.html'), head + fill(page).replace('<!--LOGIC-->', '<script src="logic.js"></script>') + '</body></html>');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/demo.html'), fill(page).replace('<!--LOGIC-->', () => '<script>\n' + logic + '\n</script>'));
console.log('ok: public/index.html e dist/demo.html');
