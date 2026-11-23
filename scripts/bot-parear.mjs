// Reconecta o robô ao WhatsApp com código de 8 dígitos (sem QR). Uso:
//   node ~/volei-gran-felicita/scripts/bot-parear.mjs <pasta-de-login-nova> <telefone-com-DDI>
import { createRequire } from 'module';
import os from 'os';
const req = createRequire(os.homedir() + '/volei-bot-v2/index.js');
let B; try { B = req('@whiskeysockets/baileys'); } catch (e) { B = req('baileys'); }
const makeWASocket = B.default || B.makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = B;
const [dir, phone] = process.argv.slice(2);
let pediu = false;
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  let version; try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) {}
  const sock = makeWASocket({ auth: state, version, printQRInTerminal: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false, browser: ['Ubuntu', 'Chrome', '22.04'], logger: req('pino')({ level: 'silent' }) });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pediu && !state.creds.registered) {
      pediu = true;
      const code = await sock.requestPairingCode(phone);
      console.log('\n\n   CÓDIGO:  ' + code.slice(0, 4) + '-' + code.slice(4) + '\n\nNo WhatsApp: Configurações → Aparelhos conectados → Conectar aparelho → "Conectar com número de telefone" e digite o código.\n');
    }
    if (connection === 'open') { console.log('✅ Conectado! Salvando e saindo em 15s...'); setTimeout(() => process.exit(0), 15000); }
    if (connection === 'close') {
      const c = lastDisconnect?.error?.output?.statusCode;
      if (c === DisconnectReason.loggedOut) { console.log('❌ Recusado (deslogado).'); process.exit(1); }
      start();
    }
  });
}
start();
