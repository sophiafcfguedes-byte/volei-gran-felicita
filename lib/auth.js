/* Sessão de jogador: um código derivado do id + senha do jogador + segredo do servidor.
   Se a senha da pessoa mudar, o código antigo para de valer e ela precisa entrar de novo. */
const { createHash } = require('crypto');

function token(secret, pid, pin) {
  return createHash('sha256').update(secret + '|' + pid + '|' + String(pin || '').toUpperCase()).digest('hex').slice(0, 40);
}

/* Devolve o id do jogador se o código bater com a senha atual dele; senão null. */
function who(state, secret, pid, tok) {
  if (!pid || !tok) return null;
  const p = state.players.find(x => x.id === pid);
  return p && p.pin && tok === token(secret, pid, p.pin) ? pid : null;
}

module.exports = { token, who };
