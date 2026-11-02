#!/usr/bin/env bash
# Robô sob demanda: não liga sozinho no boot; um timer do sistema (a cada minuto) liga quando tem aviso e desliga depois.
set -e
NODE="$(command -v node)"; U="$(whoami)"
sudo systemctl disable volei-bot >/dev/null 2>&1 || true
sudo tee /etc/systemd/system/volei-demanda.service >/dev/null <<UNIT
[Unit]
Description=Liga o robô do vôlei só quando tem aviso
[Service]
Type=oneshot
User=$U
ExecStart=/bin/bash -c '$NODE $HOME/volei-gran-felicita/scripts/bot-demanda.js >> $HOME/bot-demanda.log 2>&1'
UNIT
sudo tee /etc/systemd/system/volei-demanda.timer >/dev/null <<UNIT
[Unit]
Description=Confere a cada minuto se o robô precisa mandar algo
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s
[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now volei-demanda.timer >/dev/null
echo "✅ Robô sob demanda ligado. Ele só fica online quando tem aviso pra mandar."
echo "   Histórico: tail ~/bot-demanda.log"
