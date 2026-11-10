import { cfg } from './config.js';
import { openDb } from './db.js';
import { createAi } from './ai.js';
import { createApp } from './app.js';
import { createWhatsApp, createDryWhatsApp } from './whatsapp.js';
import { loadEvents } from './calendar.js';
import { pollFathom } from './fathom.js';
import { startWeb } from './web.js';
import fs from 'node:fs';

if (!cfg.ownerPhone && !cfg.dryRun) { console.error('Falta OWNER_PHONE en el archivo .env'); process.exit(1); }
const aiKey = cfg.aiProvider === 'gemini' ? cfg.geminiKey : cfg.anthropicKey;
if (!cfg.fakeAi && !aiKey) { console.warn('Sin clave de IA: los borradores serán de ejemplo (modo prueba).'); cfg.fakeAi = true; }
if (!cfg.icsUrl) console.warn('Sin CALENDAR_ICS_URL: la lectura del calendario está desactivada.');

const db = openDb(cfg.dbPath);
fs.mkdirSync(cfg.dataDir, { recursive: true });
for (const f of [cfg.learned, cfg.proposals]) if (!fs.existsSync(f)) fs.writeFileSync(f, '');
const state = { qr: null, connected: false };
startWeb({ cfg, state });
let app;
const wa = cfg.dryRun
  ? createDryWhatsApp()
  : createWhatsApp({ cfg, db, state, isLead: (p) => !!db.leadByPhone(p), onOwner: (t, r) => app.handleOwnerText(t, r), onLead: (...a) => app.handleLeadText(...a) });
const ai = createAi(cfg);
app = createApp({ cfg, db, wa, ai, loadEvents: () => loadEvents({ url: cfg.icsUrl, from: new Date(Date.now() - 24 * 3600e3), to: new Date(Date.now() + 21 * 864e5) }) });

await wa.start();
const every = (ms, name, fn) => {
  const run = async () => { try { await fn(); } catch (e) { console.error(`[${name}]`, e.message); } };
  setTimeout(run, 10_000); setInterval(run, ms);
};
if (cfg.icsUrl) every(5 * 60e3, 'calendario', () => app.syncCalendar());
every(10 * 60e3, 'fathom', () => pollFathom({ cfg, db, app }));
every(60e3, 'seguimientos', () => app.processFollowups());
every(60e3, 'reporte', () => app.maybeDailyReport());
console.log(`Agente ${cfg.agentName} activo. Modo ${Object.values(cfg.auto).some(Boolean) ? 'con envíos automáticos parciales' : 'seguro (todo requiere tu aprobación)'}.`);
