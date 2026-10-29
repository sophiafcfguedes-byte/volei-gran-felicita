#!/usr/bin/env bash
# Guarda o "usuário" (login) do Vida de Síndico, usado pelo sistema novo (autorizações de acesso).
set -e
cd "$HOME/volei-gran-felicita"
VLOGIN="$1" node -e 'const f=process.env.HOME+"/.volei-vds.json",fs=require("fs");const c=JSON.parse(fs.readFileSync(f,"utf8"));c.login=process.env.VLOGIN;fs.writeFileSync(f,JSON.stringify(c),{mode:0o600})'
node scripts/vds-acesso-test.js
