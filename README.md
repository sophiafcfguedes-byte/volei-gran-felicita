# Vôlei Gran Felicitá

## Rodando na Oracle Cloud (grátis)

Na máquina da Oracle, rode:

```bash
curl -fsSL https://raw.githubusercontent.com/sophiafcfguedes-byte/volei-gran-felicita/oracle/scripts/oracle-setup.sh -o oracle-setup.sh && bash oracle-setup.sh
```

O script instala o que faltar, traz os dados do Netlify, liga o app com HTTPS e mostra o endereço.
Para atualizar depois: `bash ~/volei-gran-felicita/scripts/update.sh`

---


App de celular do grupo: lista de presença, prioridade pra quem pagou a vaquinha, lista de espera, convidados, sorteio de times equilibrado, placar, frequência, sugestões e painel de admin.

## Colocar no ar no Netlify (link `volei-gran-felicita.netlify.app`)

O Netlify publica direto de um repositório do GitHub. Tudo pelo navegador, sem instalar nada. Leva uns 10 minutos.

### 1. Subir os arquivos pro GitHub
1. Entre em github.com (crie uma conta se não tiver).
2. Clique em **+ → New repository**. Nome: `volei-gran-felicita`. Pode deixar **Private**. Clique em **Create repository**.
3. Na página do repositório vazio, clique no link **uploading an existing file**.
4. Descompacte o zip no computador, abra a pasta `volei-app` e **arraste tudo que está dentro dela** pra página do GitHub (as pastas `assets`, `netlify`, `public`, `src`, `dist` e os arquivos soltos).
   O arquivo `netlify.toml` precisa ficar na raiz do repositório, não dentro de outra pasta.
5. Clique em **Commit changes**.

### 2. Criar o site no Netlify
1. Entre em app.netlify.com e clique em **Sign up with GitHub** (ou entre na sua conta).
2. **Add new project → Import an existing project → GitHub** → autorize → escolha `volei-gran-felicita`.
3. Em *Project name* (ou *Site name*) escreva `volei-gran-felicita`. Os campos de build já vêm preenchidos pelo `netlify.toml`.
4. Antes de publicar, em **Environment variables → Add variable**, crie:
   - Key: `ADMIN_PASSWORD`
   - Value: a senha de admin que você quiser
5. Clique em **Deploy**. Em 1 ou 2 minutos o link `https://volei-gran-felicita.netlify.app` está no ar.

Se o nome já estiver em uso, o Netlify avisa; escolha outro, tipo `volei-granfelicita`.
Esqueceu a senha no passo 4? Vá em **Project configuration → Environment variables**, adicione, depois em **Deploys → Trigger deploy**.

### 3. Primeiro uso
1. Abra o link → **Mais → Admin** → entre com a senha do `ADMIN_PASSWORD`.
2. **Admin · Jogo**: título, data, horário, vagas (ex.: 18), jogadores por time e quantas pessoas cada um pode marcar além de si (padrão 3).
3. **Admin · Jogadores**: cadastre todo mundo com gênero, nível (1 a 5) e se pagou a vaquinha. O nível só aparece pra admin.
4. Mande o link no grupo. Cada pessoa toca em **Escolher** e seleciona o próprio nome uma vez (o celular lembra).
5. Depois do jogo: **Encerrar jogo e limpar lista** soma 1 na frequência de quem estava confirmado e deixa tudo pronto pro próximo.

Os dados ficam guardados no próprio Netlify (Netlify Blobs). Não precisa de banco de dados.

## Mudar alguma coisa depois
Edite o arquivo no GitHub (ou suba de novo). O Netlify republica sozinho a cada mudança.
A interface fica em `src/page.html`; o Netlify roda `node build.js` e gera `public/index.html`.

## Regras da lista
- Cada pessoa marca a si mesma e até N outras (padrão 3), incluindo convidados. Tirar não tem limite.
- Quem pagou a vaquinha passa na frente; depois vale a ordem de chegada.
- Passou das vagas, vai pra lista de espera, que sobe sozinha quando alguém sai.
- Admin pode fechar a lista na hora (por X minutos) ou toda semana num horário fixo (horário de Brasília). Com a lista fechada, só admin mexe.
- O sorteio espalha os levantadores, depois as mulheres, depois os homens, sempre equilibrando a soma dos níveis. Quem está marcado como atrasado ganha um substituto da lista de espera.

## Integração com o robô do WhatsApp
`https://volei-gran-felicita.netlify.app/api/resumo` devolve a lista pronta em texto. O robô pode buscar esse endereço e mandar no grupo, ou mandar o link do app junto com a enquete.

## Vários jogos (segunda, quarta, quinta)
Crie um site no Netlify pra cada jogo, a partir do mesmo repositório (ex.: `volei-gran-felicita-quarta`). Cada site tem sua própria lista.

## Arquivos
| Arquivo | O que é |
|---|---|
| `netlify/functions/api.mjs` | A API no Netlify (lista, ações, resumo). |
| `public/logic.js` | Regras da lista, da prioridade e do sorteio. |
| `src/page.html` | Fonte da interface. |
| `assets/` | Escudo e andorinha do Gran Felicitá. |
| `server.js` | Alternativa sem Netlify: servidor Node para rodar numa VM (`ADMIN_PASSWORD=... node server.js`). |
| `dist/demo.html` | Demonstração num arquivo só, com dados de exemplo. |
