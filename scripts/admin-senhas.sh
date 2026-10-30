#!/usr/bin/env bash
# Define as senhas de admin do app (uma ou mais). Quem estava logado como admin com senha antiga sai.
set -e
echo "Digite as senhas de admin, uma por vez (não aparecem). Enter vazio para terminar."
: > /tmp/.va; n=0
while true; do
  read -r -s -p "Senha $((n+1)): " P; echo
  [ -z "$P" ] && break
  [ ${#P} -lt 4 ] && { echo "Muito curta, use pelo menos 4 caracteres."; continue; }
  printf '%s\n' "$P" >> /tmp/.va; n=$((n+1))
done
[ $n -gt 0 ] || { rm -f /tmp/.va; echo "Nenhuma senha digitada, nada mudou."; exit 1; }
install -m 600 /tmp/.va "$HOME/.volei-admins"; rm -f /tmp/.va
echo "✅ $n senha(s) de admin salvas. Vale na hora, sem reiniciar."
