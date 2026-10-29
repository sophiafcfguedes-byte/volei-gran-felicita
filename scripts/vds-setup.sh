#!/usr/bin/env bash
# Guarda o login do Vida de Síndico só nesta máquina (~/.volei-vds.json, só você lê) e testa.
set -e
cd "$HOME/volei-gran-felicita"
read -r -p "Usuário do Vida de Síndico (e-mail): " VUSER
read -r -s -p "Senha (não aparece enquanto digita): " VPASS; echo
umask 077
VUSER="$VUSER" VPASS="$VPASS" node -e 'require("fs").writeFileSync(process.env.HOME + "/.volei-vds.json", JSON.stringify({ user: process.env.VUSER, pass: process.env.VPASS }), { mode: 0o600 })'
chmod 600 "$HOME/.volei-vds.json"
node scripts/vds-test.js && pm2 restart volei --update-env >/dev/null && echo "✅ App reiniciado: a aba Reservas atualiza a cada 30 min."
