#!/usr/bin/env bash
# Volta ao robô sempre ligado (desfaz o "sob demanda").
( crontab -l 2>/dev/null | grep -v bot-demanda.js ) | crontab -
sudo systemctl enable volei-bot && sudo systemctl start volei-bot
echo "✅ Robô ligado o tempo todo de novo."
