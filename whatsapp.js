import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GROUPS = { reportes: 'Reportes IA', confirmaciones: 'Confirmaciones IA', pagos: 'Pagos IA' };
const phoneOf = (jid) => (jid && /@s\.whatsapp\.net$/.test(jid) ? jid.split('@')[0].split(':')[0] : null);

function extract(m) {
  const x = m.message?.ephemeralMessage?.message || m.message || {};
  const type = Object.keys(x).find((k) => k !== 'messageContextInfo') || 'unknown';
  const text = x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption || null;
  return { text, type };
}

// Modo de prueba: no conecta a WhatsApp, solo imprime lo que enviaría.
export function createDryWhatsApp() {
  return {
    async start() { console.log('[modo prueba] WhatsApp no conectado'); },
    async sendLead(phone, text) { console.log(`\n[→ lead ${phone}]\n${text}\n`); return true; },
    notifyOwner(text) { console.log(`\n[→ tu WhatsApp personal]\n${text}\n`); },
    notifyGroup(key, text) { console.log(`\n[→ grupo ${key}]\n${text}\n`); },
  };
}

export function createWhatsApp({ cfg, db, state = {}, isLead, onOwner, onLead }) {
  const ownerJid = `${cfg.ownerPhone}@s.whatsapp.net`;
  const ownerLid = process.env.OWNER_LID || '';
  let sock;
  let chain = Promise.resolve();
  let warned = new Set();

  function sender(key) {
    for (const c of [key.participantAlt, key.remoteJidAlt, key.senderPn, key.participantPn, key.participant, key.remoteJid]) {
      const p = phoneOf(c);
      if (p) return p;
    }
    return null;
  }

  async function onUpsert({ messages, type }) {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        if (!m.message || m.key.fromMe) continue;
        const jid = m.key.remoteJid;
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;
        const isGroup = jid.endsWith('@g.us');
        const from = sender(m.key);
        const isOwner = from === cfg.ownerPhone || (ownerLid && (jid === ownerLid || m.key.participant === ownerLid));
        const { text, type: mtype } = extract(m);
        if (isOwner) { if (text) await onOwner(text, (t) => sock.sendMessage(jid, { text: t })); continue; }
        if (isGroup) continue;                       // en grupos solo atiende tus comandos
        if (!from) {
          if (jid.endsWith('@lid') && !warned.has(jid)) { warned.add(jid); console.log(`Mensaje de un identificador sin teléfono (${jid}). Si es tu WhatsApp personal, agrega OWNER_LID=${jid} al archivo .env`); }
          continue;
        }
        if (isLead(from)) await onLead(from, text, mtype);  // cualquier otro chat se ignora y no se guarda
      } catch (e) { console.error('Error procesando mensaje:', e.message); }
    }
  }

  async function ensureGroups() {
    for (const [key, name] of Object.entries(GROUPS)) {
      if (db.kv(`group:${key}`)) continue;
      const g = await sock.groupCreate(name, [ownerJid]);
      db.kv(`group:${key}`, g.id);
      await sock.sendMessage(g.id, { text: `${name}: aquí te aviso ${key === 'reportes' ? 'del reporte diario y de quién pide hablar con una persona' : key === 'confirmaciones' ? 'de nuevas agendas, confirmaciones, cambios y cancelaciones' : 'de cada llamada que terminó para que confirmes si pagó'}.` });
    }
  }

  async function connect() {
    const { state: authState, saveCreds } = await useMultiFileAuthState(cfg.authDir);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, auth: authState, logger: pino({ level: 'silent' }), browser: ['Setter IA', 'Chrome', '1.0.0'], markOnlineOnConnect: false, syncFullHistory: false });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', onUpsert);
    return new Promise((resolve) => {
      sock.ev.on('connection.update', async (u) => {
        if (u.qr) { state.qr = u.qr; console.log('\nEscanea este QR con el WhatsApp Business del SEGUNDO número (Dispositivos vinculados):\n'); qrcode.generate(u.qr, { small: true }); }
        if (u.connection === 'open') {
          state.connected = true; state.qr = null;
          console.log('WhatsApp conectado.');
          try { await ensureGroups(); } catch (e) { console.error('No pude crear los grupos:', e.message); }
          resolve();
        }
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) { console.error('La sesión se cerró. Borra la carpeta data/auth y vuelve a escanear el QR.'); process.exit(1); }
          state.connected = false;
          console.log('Conexión cerrada, reintentando...'); setTimeout(connect, 4000);
        }
      });
    });
  }

  async function doSend(phone, text) {
    const jid = `${phone}@s.whatsapp.net`;
    const [ex] = (await sock.onWhatsApp(jid)) || [];
    if (!ex?.exists) return false;
    await sock.presenceSubscribe(ex.jid);
    await sock.sendPresenceUpdate('composing', ex.jid);
    await sleep(Math.min(9000, 1500 + text.length * 35));
    await sock.sendMessage(ex.jid, { text });
    await sock.sendPresenceUpdate('paused', ex.jid);
    await sleep(8000 + Math.random() * 12000);   // ritmo humano entre mensajes
    return true;
  }

  return {
    start: connect,
    sendLead(phone, text) {
      const p = chain.then(() => doSend(phone, text)).catch((e) => { console.error('Error enviando:', e.message); return false; });
      chain = p.then(() => {});
      return p;
    },
    notifyOwner: (text) => sock.sendMessage(ownerJid, { text }).catch((e) => console.error('No pude avisarte:', e.message)),
    notifyGroup(key, text) {
      const jid = db.kv(`group:${key}`) || ownerJid;
      return sock.sendMessage(jid, { text }).catch((e) => console.error('No pude escribir al grupo:', e.message));
    },
  };
}
