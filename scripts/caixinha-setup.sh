#!/usr/bin/env bash
# Instala os leitores de comprovante (fotos e PDF) e atualiza o app.
set -e
sudo apt-get update -qq
sudo apt-get install -y -qq tesseract-ocr tesseract-ocr-por poppler-utils >/dev/null
echo "✅ Leitor de comprovantes instalado: $(tesseract --version 2>&1 | head -1)"
bash "$HOME/volei-gran-felicita/scripts/update.sh"
