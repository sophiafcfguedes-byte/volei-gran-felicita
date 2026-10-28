#!/usr/bin/env bash
# Atualiza o app com a versão mais nova do GitHub e reinicia. Os dados (data.json) ficam.
set -e
cd "$HOME/volei-gran-felicita"
git pull --ff-only
node build.js
pm2 restart volei --update-env
echo "✅ Atualizado."
