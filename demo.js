// Demo sin WhatsApp ni IA real: muestra lo que haría el agente con 3 agendas de ejemplo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createDryWhatsApp } from '../src/whatsapp.js';
import { loadEvents } from '../src/calendar.js';
import { sampleIcs } from '../test/helpers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
const cfg = { ownerPhone: '573000000000', defaultCC: '57', tz: 'America/Bogota', agentName: 'Lía', fakeAi: true,
  auto: { opening: false, reminder: false, reply: false, followup: false, postsale: false },
  proposals: path.join(dir, 'p.md'), learned: path.join(dir, 'a.md'), playbook: path.join(dir, 'x.md') };
fs.writeFileSync(cfg.proposals, ''); fs.writeFileSync(cfg.learned, '');
const ics = sampleIcs([
  { uid: '1', hours: 30, summary: 'GENIA · Ana Ejemplo X SaleADS', description: 'Phone:- 300 1112233\\nInversión en ads/mes: $1.000 a $3.000 USD' },
  { uid: '2', hours: 53, summary: 'Carlos Prueba X SaleADS', description: 'Phone:- 311 4445566\\nInversión en ads/mes: Más de $5.000 USD' },
]);
const db = openDb(':memory:');
const ai = { async draft() { return { reply: 'Gracias por contarme.\nY ya estás usando SaleADS o apenas lo estás conociendo?', needs_human: false, intent: 'otro' }; },
  async classifyCall() { return { outcome: 'pendiente', objeciones: ['precio'], siguiente_paso: 'hablar con su socio', resumen_corto: 'Le interesó el Business.' }; } };
const app = createApp({ cfg, db, wa: createDryWhatsApp(), ai, loadEvents: () => loadEvents({ icsText: ics }) });
const owner = (t) => console.log(`\n[tú escribes] ${t}\n`);

console.log('=== 1. El agente lee el calendario ===');
await app.syncCalendar();
console.log('=== 2. Apruebas el primer borrador ===');
owner('ok 1'); await app.handleOwnerText('ok 1', (t) => console.log(`[agente → tú] ${t}`));
console.log('=== 3. El lead responde ===');
await app.handleLeadText('573001112233', 'Tengo una tienda de ropa', 'conversation');
console.log('=== 4. Terminó la llamada: dices que no pagó ===');
owner('no pagó Ana'); await app.handleOwnerText('no pagó Ana', (t) => console.log(`[agente → tú] ${t}`));
console.log('=== 5. Estado ===');
await app.handleOwnerText('estado', (t) => console.log(`[agente → tú]\n${t}`));
