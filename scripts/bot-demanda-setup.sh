#!/usr/bin/env bash
# Robô sob demanda: não liga sozinho no boot; o cron liga quando tem aviso e desliga depois.
set -e
NODE="$(command -v node)"
sudo systemctl disable volei-bot >/dev/null 2>&1 || true
LINE="* * * * * $NODE $HOME/volei-gran-felicita/scripts/bot-demanda.js >> $HOME/bot-demanda.log 2>&1"
( crontab -l 2>/dev/null | grep -v bot-demanda.js; echo "$LINE" ) | crontab -
echo "✅ Robô sob demanda ligado. Ele só fica online quando tem aviso pra mandar."
echo "   Histórico: tail ~/bot-demanda.log"
