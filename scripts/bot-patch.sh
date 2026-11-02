#!/usr/bin/env bash
# Atualiza o código do robô SEM reiniciar (não manda nada no grupo). Vale na próxima vez que ele ligar.
set -e
BOT="$HOME/volei-bot-v2/index.js"
cd "$HOME/volei-gran-felicita" && git pull -q && bash scripts/update.sh >/dev/null
cp "$BOT" "$BOT.bak-$(date +%Y%m%d%H%M)"
node scripts/patch-bot.mjs "$BOT" && node --check "$BOT"
echo "✅ Robô atualizado sem reiniciar. Vale na próxima vez que ele ligar (sob demanda)."
