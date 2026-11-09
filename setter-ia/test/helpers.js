import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { loadEvents } from '../src/calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const ics = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

export function sampleIcs(items) {
  const ev = items.map((it, i) => {
    const s = new Date(Date.now() + it.hours * 3600e3), e = new Date(+s + 30 * 60e3);
    return `BEGIN:VEVENT\nUID:evt-${it.uid ?? i}\nDTSTART:${ics(s)}\nDTEND:${ics(e)}\nSUMMARY:${it.summary}\nDESCRIPTION:${it.description}\nEND:VEVENT`;
  }).join('\n');
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//test//ES\n${ev}\nEND:VCALENDAR`;
}

export function makeApp({ ai, icsText, auto = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setter-'));
  const cfg = { ownerPhone: '573000000000', defaultCC: '57', tz: 'America/Bogota', agentName: 'Lía', fakeAi: true,
    auto: { opening: false, reminder: false, reply: false, followup: false, postsale: false, ...auto },
    proposals: path.join(dir, 'propuestas.md'), learned: path.join(dir, 'aprendizajes.md'), playbook: path.join(dir, 'p.md') };
  fs.writeFileSync(cfg.proposals, ''); fs.writeFileSync(cfg.learned, '');
  const db = openDb(':memory:');
  const log = { owner: [], groups: [], leads: [] };
  const wa = {
    async sendLead(phone, text) { log.leads.push({ phone, text }); return true; },
    notifyOwner(t) { log.owner.push(t); },
    notifyGroup(k, t) { log.groups.push({ k, t }); },
  };
  const fakeAi = ai || {
    async draft() { return { reply: 'Gracias por contarme. Y ya estás usando SaleADS o apenas lo estás conociendo?', needs_human: false, reason: '', intent: 'otro' }; },
    async classifyCall() { return { outcome: 'pendiente', objeciones: ['precio'], siguiente_paso: 'hablar con su socio', resumen_corto: 'Le interesó el Business.' }; },
  };
  const app = createApp({ cfg, db, wa, ai: fakeAi, loadEvents: () => loadEvents({ icsText: typeof icsText === 'function' ? icsText() : icsText }) });
  return { app, db, log, cfg };
}
