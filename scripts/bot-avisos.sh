#!/usr/bin/env bash
# Atualiza o app e ajusta o robô: sem enquetes, com aviso de lista completa no grupo.
set -e
BOT="$HOME/volei-bot-v2/index.js"
bash "$HOME/volei-gran-felicita/scripts/update.sh"
[ -f "$BOT" ] || { echo "Não achei $BOT"; exit 1; }
cp "$BOT" "$BOT.bak-$(date +%Y%m%d%H%M)"
NODE="$(command -v node)"
"$NODE" "$HOME/volei-gran-felicita/scripts/patch-bot.mjs" "$BOT"
"$NODE" --check "$BOT"
sudo systemctl enable --now volei-bot
sleep 8
sudo journalctl -u volei-bot --no-pager -n 12 | cut -c1-200
echo "✅ Robô ligado: enquetes desligadas; manda a lista no grupo quando completar."
