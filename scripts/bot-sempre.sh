#!/usr/bin/env bash
# Volta ao robô sempre ligado (desfaz o "sob demanda").
sudo systemctl disable --now volei-demanda.timer >/dev/null 2>&1 || true
sudo systemctl enable volei-bot && sudo systemctl start volei-bot
echo "✅ Robô ligado o tempo todo de novo."
