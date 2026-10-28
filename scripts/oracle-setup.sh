#!/usr/bin/env bash
# Instala o Vôlei Gran Felicitá nesta máquina (Ubuntu ou Oracle Linux), com HTTPS.
# Uso:  bash oracle-setup.sh
set -euo pipefail
APP_DIR="$HOME/volei-gran-felicita"
PORT=3077
REPO="https://github.com/sophiafcfguedes-byte/volei-gran-felicita"
NETLIFY="https://voleigranfelicita.netlify.app"
say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }

read -rsp "Senha de admin do app (use a mesma do Netlify): " ADMIN_PASSWORD; echo
[ -n "$ADMIN_PASSWORD" ] || { echo "Precisa de uma senha."; exit 1; }

say "1/6 Conferindo Node.js e git"
if command -v apt-get >/dev/null; then PKG=apt; else PKG=dnf; fi
command -v git >/dev/null || { [ $PKG = apt ] && sudo apt-get update -y && sudo apt-get install -y git || sudo dnf install -y git; }
NODE_OK=0; command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] && NODE_OK=1
if [ $NODE_OK = 0 ]; then
  if [ $PKG = apt ]; then curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
  else curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs; fi
fi
command -v pm2 >/dev/null || sudo npm install -g pm2
echo "Node $(node -v)"

say "2/6 Baixando o app"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone -b oracle "$REPO" "$APP_DIR"; fi
cd "$APP_DIR" && node build.js

say "3/6 Trazendo a lista e os cadastros que já estão no Netlify"
if [ -f data.json ]; then echo "Já existe data.json, mantendo."; else
  TOKEN=$(node -e "console.log(require('crypto').createHash('sha256').update('volei:'+process.argv[1]).digest('hex'))" "$ADMIN_PASSWORD")
  if curl -fsS -H "x-admin-token: $TOKEN" "$NETLIFY/api/state" -o /tmp/volei-netlify.json && node -e '
      const j=JSON.parse(require("fs").readFileSync("/tmp/volei-netlify.json","utf8"));
      if(!j.isAdmin){console.error("A senha não bate com a do Netlify.");process.exit(1)}
      require("fs").writeFileSync("data.json",JSON.stringify(j.state));
      console.log("Importado:", j.state.players.length, "jogadores");'; then :; else
    echo "Não consegui importar do Netlify. O app começa vazio (dá pra cadastrar de novo no Admin)."; fi
  rm -f /tmp/volei-netlify.json
fi

say "4/6 Ligando o app (fica rodando sozinho, mesmo se a máquina reiniciar)"
pm2 delete volei >/dev/null 2>&1 || true
ADMIN_PASSWORD="$ADMIN_PASSWORD" PORT=$PORT pm2 start server.js --name volei --update-env
pm2 save
sudo env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null
sleep 1; curl -fsS "http://localhost:$PORT/api/resumo" >/dev/null && echo "App respondendo na porta $PORT."

say "5/6 Endereço com HTTPS (Caddy)"
IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
DOMAIN="volei-gran-felicita.${IP//./-}.sslip.io"
if ! command -v caddy >/dev/null; then
  case "$(uname -m)" in aarch64|arm64) ARCH=arm64;; *) ARCH=amd64;; esac
  sudo curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$ARCH" -o /usr/local/bin/caddy
  sudo chmod +x /usr/local/bin/caddy
fi
sudo mkdir -p /etc/caddy
printf '%s {\n\tencode gzip\n\treverse_proxy localhost:%s\n}\n' "$DOMAIN" "$PORT" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo tee /etc/systemd/system/caddy-volei.service >/dev/null <<UNIT
[Unit]
Description=Caddy (Vôlei Gran Felicitá)
After=network-online.target
[Service]
ExecStart=$(command -v caddy) run --config /etc/caddy/Caddyfile
Restart=always
Environment=HOME=/root
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable --now caddy-volei && sudo systemctl restart caddy-volei

say "6/6 Liberando as portas 80 e 443 nesta máquina"
if command -v firewall-cmd >/dev/null && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
else
  for p in 80 443; do sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport $p -j ACCEPT; done
  command -v netfilter-persistent >/dev/null && sudo netfilter-persistent save || true
fi

cat <<FIM

✅ Pronto! Endereço do app:

   https://$DOMAIN

Se não abrir em 1 minuto, falta liberar as portas 80 e 443 no painel da Oracle
(Networking → Virtual Cloud Networks → sua VCN → Security Lists → Add Ingress Rules).
Para atualizar o app no futuro:  bash $APP_DIR/scripts/update.sh
FIM
