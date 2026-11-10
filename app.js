import fs from 'node:fs';
import { normPhone, norm, fmtWhen, localDate, sanitize, issues, openingMessage, parseApproval, firstName, investPhrase } from './text.js';

const AUTO_KEY = { opening: 'opening', reminder24: 'reminder', reminder2h: 'reminder', reply: 'reply', followup1: 'followup', followup2: 'followup', followup3: 'followup', post_hoy: 'postsale', post_24h: 'postsale', post_7d: 'postsale', post_30d: 'postsale' };
const KIND = { opening: 'Pre-call', reminder24: 'Recordatorio 24 h', reminder2h: 'Recordatorio 2 h', reply: 'Respuesta', followup1: 'Seguimiento 1', followup2: 'Seguimiento 2', followup3: 'Seguimiento 3', post_hoy: 'Postventa (felicitación)', post_24h: 'Postventa 24 h', post_7d: 'Postventa 7 días', post_30d: 'Postventa 30 días' };
const STATUS = { nuevo: 'nuevo', precall: 'en pre-call', confirmado: 'confirmó', cancelado: 'canceló', llamada_hecha: 'llamada hecha', seguimiento: 'en seguimiento', cliente: 'cliente', humano: 'con Jorge', sin_interes: 'sin interés' };
const OUTCOME = { compro: 'compró', no_compro: 'no compró', pendiente: 'quedó pendiente', no_show: 'no se presentó', incierto: 'no queda claro' };
const HELP = `Comandos:\n\nok 12 · no 12 · editar 12: texto\n\npendientes · hoy · estado\n\npagó Nombre · no pagó Nombre\n\nia 3001234567 Nombre (agrega un lead) · humano Nombre · ia Nombre (devuelve el lead al agente)\n\npausar · reanudar\n\naprender: regla nueva · aprobar regla 3 · rechazar regla 3`;

export function createApp({ cfg, db, wa, ai, loadEvents }) {
  const owner = (t) => wa.notifyOwner(t);
  const group = (k, t) => wa.notifyGroup(k, t);
  const when = (iso) => fmtWhen(iso, cfg.tz);
  const paused = () => db.kv('paused') === '1';
  const label = (l) => `${l.name} (${STATUS[l.status] || l.status})`;

  function ensureReminders(lead) {
    db.clearPending(lead.phone, ['reminder24', 'reminder2h', 'ask_payment']);
    if (!lead.call_start) return;
    const start = new Date(lead.call_start), end = new Date(lead.call_end || lead.call_start), now = new Date();
    const r24 = new Date(+start - 24 * 3600e3), r2 = new Date(+start - 2 * 3600e3);
    if (r24 > now) db.schedule(lead.phone, 'reminder24', r24);
    if (r2 > now) db.schedule(lead.phone, 'reminder2h', r2);
    db.schedule(lead.phone, 'ask_payment', new Date(+end + 10 * 60e3));
  }

  async function sendApproval(id, override) {
    const ap = db.get('SELECT * FROM approvals WHERE id=?', id);
    if (!ap || ap.status !== 'pendiente') return false;
    const lead = db.leadByPhone(ap.phone);
    if (!lead || lead.opted_out) { db.run("UPDATE approvals SET status='descartado' WHERE id=?", id); return false; }
    const text = sanitize(override ?? ap.draft);
    const ok = await wa.sendLead(ap.phone, text);
    if (!ok) { owner(`No pude enviar a ${lead.name} (${ap.phone}). Revisa que el número tenga WhatsApp.`); return false; }
    db.addMsg(ap.phone, 'out', text);
    db.run("UPDATE approvals SET status='enviado', draft=? WHERE id=?", text, id);
    if (ap.kind === 'opening' && ['nuevo', 'precall'].includes(lead.status)) db.run("UPDATE leads SET status='precall' WHERE phone=?", ap.phone);
    return true;
  }

  async function propose({ phone, kind, draft }) {
    const lead = db.leadByPhone(phone);
    const text = sanitize(draft);
    const probs = issues(text);
    const { id } = db.run('INSERT INTO approvals(phone,kind,draft) VALUES(?,?,?)', phone, kind, text);
    if (cfg.auto[AUTO_KEY[kind]] && !probs.length && !paused()) { await sendApproval(id); return id; }
    owner(`Aprobación ${id} · ${KIND[kind] || kind} · ${lead?.name}\n\nBorrador:\n\n${text}\n\n${probs.length ? `Ojo: ${probs.join(', ')}\n\n` : ''}Responde ok ${id} para enviar, no ${id} para descartar, o editar ${id}: nuevo texto`);
    return id;
  }

  // ---------- Calendario ----------
  async function syncCalendar() {
    const events = await loadEvents();
    const seen = new Set();
    for (const ev of events) {
      seen.add(ev.uid);
      const phone = normPhone(ev.phone, cfg.defaultCC);
      const w = when(ev.start);
      if (!phone) {
        if (!db.kv(`nophone:${ev.uid}`)) { db.kv(`nophone:${ev.uid}`, '1'); group('confirmaciones', `Agenda sin teléfono: ${ev.name} · ${w.day} a las ${w.time}. Agrégalo con: ia 300... ${ev.name}`); }
        continue;
      }
      const start = ev.start.toISOString(), end = ev.end.toISOString();
      let lead = db.leadByPhone(phone);
      if (!lead) {
        db.run('INSERT INTO leads(phone,name,email,event_id,call_start,call_end,invest,source,reschedule_url,status) VALUES(?,?,?,?,?,?,?,?,?,?)',
          phone, ev.name, ev.email, ev.uid, start, end, ev.invest, ev.source, ev.reschedule, 'nuevo');
        lead = db.leadByPhone(phone);
        group('confirmaciones', `Nueva agenda: ${lead.name} · ${w.day} a las ${w.time}${ev.invest ? ` · inversión ${ev.invest}` : ''}`);
        ensureReminders(lead);
        if (cfg.skipOpeningsBefore && ev.start < cfg.skipOpeningsBefore) { db.run("UPDATE leads SET status='precall' WHERE phone=?", phone); continue; }
        await propose({ phone, kind: 'opening', draft: openingMessage({ name: lead.name, agent: cfg.agentName, when: w, invest: ev.invest }) });
      } else if (lead.call_start !== start || lead.event_id !== ev.uid) {
        const prevIso = lead.call_start;
        const prev = prevIso ? when(prevIso) : null;
        db.run("UPDATE leads SET event_id=?, call_start=?, call_end=?, invest=COALESCE(?,invest), reschedule_url=COALESCE(?,reschedule_url), status=CASE WHEN status IN ('cancelado','nuevo') THEN 'precall' ELSE status END WHERE phone=?",
          ev.uid, start, end, ev.invest, ev.reschedule, phone);
        lead = db.leadByPhone(phone);
        ensureReminders(lead);
        if (prev && prevIso !== start) group('confirmaciones', `Modificó la agenda: ${lead.name} pasó de ${prev.day} ${prev.time} a ${w.day} ${w.time}`);
      }
    }
    // Agendas que desaparecieron del calendario = canceladas
    const upcoming = db.all("SELECT * FROM leads WHERE event_id IS NOT NULL AND status IN ('nuevo','precall','confirmado') AND call_start > ?", new Date().toISOString());
    for (const l of upcoming) {
      if (seen.has(l.event_id)) continue;
      db.run("UPDATE leads SET status='cancelado' WHERE phone=?", l.phone);
      db.clearPending(l.phone, ['reminder24', 'reminder2h', 'ask_payment']);
      const w = when(l.call_start);
      group('confirmaciones', `Canceló: ${l.name} · tenía ${w.day} a las ${w.time}`);
    }
  }

  // ---------- Mensajes de leads ----------
  async function handleLeadText(phone, text, type) {
    const lead = db.leadByPhone(phone);
    if (!lead) return;
    db.addMsg(phone, 'in', text ?? `[${String(type).replace('Message', '')}]`);
    if (paused()) return;
    if (text && /(no (me )?escrib|deja(r)? de escribir|dejen de escribir|^stop$|darme de baja)/i.test(text)) {
      db.run('UPDATE leads SET opted_out=1 WHERE phone=?', phone);
      owner(`${lead.name} pidió no recibir más mensajes. Quedó marcado y no se le escribirá.`);
      return;
    }
    if (lead.status === 'humano') { owner(`${lead.name} escribió (está contigo):\n\n${text ?? `[${type}]`}`); return; }
    if (!text) {
      owner(`${lead.name} envió un mensaje de tipo ${String(type).replace('Message', '')}. Revísalo tú; el agente aún no procesa audio, imágenes ni video.`);
      return propose({ phone, kind: 'reply', draft: 'Gracias por tu mensaje, lo reviso y te respondo enseguida.' });
    }
    let out;
    try {
      out = await ai.draft({ lead, history: db.history(phone), purpose: 'reply', when: lead.call_start ? when(lead.call_start) : null });
    } catch (e) { owner(`Error con la IA al responder a ${lead.name}: ${e.message}`); return; }
    const intent = out.intent || 'otro';
    if (intent === 'confirma') { db.run("UPDATE leads SET status='confirmado' WHERE phone=? AND status IN ('nuevo','precall')", phone); group('confirmaciones', `Confirmó: ${lead.name}`); }
    if (intent === 'cancela' || intent === 'reagenda') group('confirmaciones', `${lead.name} quiere ${intent === 'cancela' ? 'cancelar' : 'reagendar'}. ${lead.reschedule_url ? `Enlace: ${lead.reschedule_url}` : ''}`);
    if (intent === 'compra') owner(`${lead.name} muestra intención de compra. Revisa la conversación.`);
    if (intent === 'pide_humano' || out.needs_human) {
      if (intent === 'pide_humano') db.run("UPDATE leads SET status='humano' WHERE phone=?", phone);
      const msg = `${lead.name} necesita a una persona (${out.reason || intent}).\n\nÚltimo mensaje:\n\n${text}`;
      owner(msg); group('reportes', msg);
      if (!out.reply) return;
    }
    if (out.reply) await propose({ phone, kind: 'reply', draft: out.reply });
  }

  // ---------- Seguimientos programados ----------
  async function processFollowups() {
    const due = db.all('SELECT * FROM followups WHERE done=0 AND due_at<=? ORDER BY due_at', new Date().toISOString());
    for (const f of due) {
      db.run('UPDATE followups SET done=1 WHERE id=?', f.id);
      const lead = db.leadByPhone(f.phone);
      if (!lead || lead.opted_out || lead.status === 'humano' || paused()) continue;
      if (f.kind === 'ask_payment') {
        if (['nuevo', 'precall', 'confirmado', 'llamada_hecha'].includes(lead.status)) {
          const n = firstName(lead.name);
          group('pagos', `Terminó la llamada con ${lead.name}.\n\nPagó? Responde pagó ${n} o no pagó ${n}`);
        }
        continue;
      }
      if (f.kind.startsWith('reminder') && !['precall', 'confirmado'].includes(lead.status)) continue;
      if (f.kind.startsWith('followup') && lead.status !== 'seguimiento') continue;
      if (f.kind.startsWith('post_') && lead.status !== 'cliente') continue;
      try {
        const out = await ai.draft({ lead, history: db.history(f.phone), purpose: f.kind, when: lead.call_start ? when(lead.call_start) : null });
        if (out.needs_human || !out.reply) { owner(`Necesito tu ayuda con ${lead.name} (${KIND[f.kind]}): ${out.reason || 'sin borrador'}`); continue; }
        await propose({ phone: f.phone, kind: f.kind, draft: out.reply });
      } catch (e) { owner(`Error con la IA en ${KIND[f.kind]} para ${lead.name}: ${e.message}`); }
    }
  }

  // ---------- Fathom ----------
  const summaryOf = (m) => m.default_summary?.markdown_formatted ?? m.summary ?? '';
  const titleOf = (m) => m.title ?? m.meeting_title ?? '';
  function matchLead(m) {
    const emails = (m.calendar_invitees || []).map((i) => String(i.email || '').toLowerCase());
    const t = norm(titleOf(m));
    const leads = db.all("SELECT * FROM leads WHERE status IN ('nuevo','precall','confirmado','llamada_hecha','seguimiento')");
    return leads.find((l) => l.email && emails.includes(l.email.toLowerCase())) || leads.find((l) => l.name && t.includes(norm(l.name)));
  }
  async function handleFathomMeeting(m) {
    const summary = summaryOf(m);
    if (!summary) return false;                       // aún sin resumen: se reintenta luego
    const lead = matchLead(m);
    if (!lead) return true;
    const items = (m.action_items || []).map((a) => a.description || a.text || String(a));
    const c = await ai.classifyCall({ title: titleOf(m), summary, actionItems: items });
    db.run("UPDATE leads SET summary=?, status=CASE WHEN status IN ('nuevo','precall','confirmado') THEN 'llamada_hecha' ELSE status END WHERE phone=?",
      `${c.resumen_corto} Objeciones: ${(c.objeciones || []).join(', ') || 'ninguna'}. Siguiente paso: ${c.siguiente_paso || '-'}`, lead.phone);
    db.clearPending(lead.phone, ['ask_payment']);
    const n = firstName(lead.name);
    group('pagos', `Fathom · ${lead.name}\n\nResultado: ${OUTCOME[c.outcome] || c.outcome}\n\n${c.resumen_corto}\n\nPagó? Responde pagó ${n} o no pagó ${n}`);
    return true;
  }

  // ---------- Comandos del dueño ----------
  function findLeads(q) {
    const d = q.replace(/\D/g, '');
    if (d.length >= 7) return db.all('SELECT * FROM leads WHERE phone LIKE ?', `%${d}`);
    const n = norm(q);
    return db.all('SELECT * FROM leads').filter((l) => norm(l.name || '').includes(n));
  }
  function oneLead(q, reply) {
    const r = findLeads(q);
    if (!r.length) { reply(`No encuentro a "${q}".`); return null; }
    if (r.length > 1) { reply(`Hay varios con ese nombre: ${r.map((l) => l.name).join(', ')}. Escribe el nombre completo o el teléfono.`); return null; }
    return r[0];
  }
  function markPaid(l) {
    db.run("UPDATE leads SET status='cliente' WHERE phone=?", l.phone);
    db.clearPending(l.phone, ['followup1', 'followup2', 'followup3', 'ask_payment']);
    const now = Date.now();
    db.schedule(l.phone, 'post_hoy', new Date(now));
    db.schedule(l.phone, 'post_24h', new Date(now + 24 * 3600e3));
    db.schedule(l.phone, 'post_7d', new Date(now + 7 * 864e5));
    db.schedule(l.phone, 'post_30d', new Date(now + 30 * 864e5));
    group('pagos', `Pago registrado: ${l.name}. Preparo la felicitación y el seguimiento de postventa.`);
  }
  function markNotPaid(l) {
    db.run("UPDATE leads SET status='seguimiento' WHERE phone=?", l.phone);
    db.clearPending(l.phone, ['followup1', 'followup2', 'followup3', 'ask_payment']);
    const now = Date.now();
    db.schedule(l.phone, 'followup1', new Date(now + 2 * 3600e3));
    db.schedule(l.phone, 'followup2', new Date(now + 48 * 3600e3));
    db.schedule(l.phone, 'followup3', new Date(now + 6 * 864e5));
    group('pagos', `Sin pago: ${l.name}. Seguimiento programado (2 h, 48 h y 6 días).`);
  }

  async function handleOwnerText(text, reply) {
    const t = text.trim();
    const ap = parseApproval(t);
    if (ap) {
      let id = ap.id;
      if (!id) {
        const pend = db.all("SELECT id FROM approvals WHERE status='pendiente' ORDER BY id");
        if (pend.length !== 1) return reply(pend.length ? `Tienes ${pend.length} pendientes. Indica el número, por ejemplo: ok ${pend[0].id}` : 'No hay nada pendiente.');
        id = pend[0].id;
      }
      const row = db.get('SELECT * FROM approvals WHERE id=?', id);
      if (!row || row.status !== 'pendiente') return reply(`La aprobación ${id} no está pendiente.`);
      if (ap.action === 'no') { db.run("UPDATE approvals SET status='descartado' WHERE id=?", id); return reply(`Descartada la ${id}.`); }
      const ok = await sendApproval(id, ap.action === 'edit' ? ap.text : undefined);
      return reply(ok ? `Enviado: ${id}.` : `No se pudo enviar la ${id}.`);
    }
    let m;
    if (/^ayuda$/i.test(t)) return reply(HELP);
    if (/^pausar$/i.test(t)) { db.kv('paused', '1'); return reply('Pausado. No escribiré a nadie hasta que digas reanudar.'); }
    if (/^reanudar$/i.test(t)) { db.kv('paused', '0'); return reply('Reanudado.'); }
    if (/^pendientes$/i.test(t)) {
      const p = db.all("SELECT a.id,a.kind,l.name FROM approvals a JOIN leads l ON l.phone=a.phone WHERE a.status='pendiente' ORDER BY a.id");
      return reply(p.length ? p.map((x) => `${x.id} · ${KIND[x.kind] || x.kind} · ${x.name}`).join('\n\n') : 'No hay aprobaciones pendientes.');
    }
    if (/^(hoy|agenda)$/i.test(t)) return reply(agendaText());
    if (/^estado$/i.test(t)) {
      const c = (s) => db.get('SELECT COUNT(*) n FROM leads WHERE status=?', s).n;
      return reply(`Leads: ${db.get('SELECT COUNT(*) n FROM leads').n}\n\nEn pre-call: ${c('precall')} · Confirmaron: ${c('confirmado')} · Seguimiento: ${c('seguimiento')} · Clientes: ${c('cliente')}\n\nAprobaciones pendientes: ${db.get("SELECT COUNT(*) n FROM approvals WHERE status='pendiente'").n}\n\n${paused() ? 'Estoy en pausa.' : 'Activo.'}`);
    }
    if ((m = t.match(/^(no\s+)?pag[oó]\s+(.+)$/i))) {
      const l = oneLead(m[2], reply); if (!l) return;
      if (m[1]) { markNotPaid(l); return reply(`Listo: ${l.name} quedó en seguimiento.`); }
      markPaid(l); return reply(`Listo: ${l.name} quedó como cliente.`);
    }
    if ((m = t.match(/^ia\s+(\+?[\d][\d\s-]{7,})\s*(.*)$/i))) {
      const phone = normPhone(m[1], cfg.defaultCC);
      if (!phone) return reply('No entendí el teléfono.');
      const name = m[2].trim() || phone;
      db.run("INSERT INTO leads(phone,name,status,ai_tag) VALUES(?,?, 'seguimiento',1) ON CONFLICT(phone) DO UPDATE SET ai_tag=1, name=CASE WHEN ?<>'' THEN ? ELSE name END", phone, name, m[2].trim(), m[2].trim());
      return reply(`Agregado ${name} (${phone}). El agente podrá atender sus mensajes.`);
    }
    if ((m = t.match(/^humano\s+(.+)$/i))) { const l = oneLead(m[1], reply); if (!l) return; db.run("UPDATE leads SET status='humano' WHERE phone=?", l.phone); return reply(`${l.name} queda contigo; el agente no responderá.`); }
    if ((m = t.match(/^ia\s+(.+)$/i))) { const l = oneLead(m[1], reply); if (!l) return; db.run("UPDATE leads SET status='seguimiento' WHERE phone=?", l.phone); return reply(`${l.name} vuelve con el agente.`); }
    if ((m = t.match(/^aprender:\s*([\s\S]+)$/i))) {
      const n = Number(db.kv('rule_seq') || 0) + 1; db.kv('rule_seq', n);
      fs.appendFileSync(cfg.proposals, `\n[${n}] ${m[1].trim()}`);
      return reply(`Regla ${n} guardada como propuesta. Para activarla escribe: aprobar regla ${n}`);
    }
    if ((m = t.match(/^(aprobar|rechazar) regla (\d+)$/i))) {
      const n = m[2]; const lines = fs.readFileSync(cfg.proposals, 'utf8').split('\n');
      const i = lines.findIndex((x) => x.startsWith(`[${n}] `));
      if (i < 0) return reply(`No encuentro la regla ${n}.`);
      if (/^aprobar/i.test(m[1])) fs.appendFileSync(cfg.learned, `\n- ${lines[i].replace(/^\[\d+\]\s*/, '')}`);
      lines[i] = `${/^aprobar/i.test(m[1]) ? '(aprobada)' : '(rechazada)'} ${lines[i]}`;
      fs.writeFileSync(cfg.proposals, lines.join('\n'));
      return reply(`Regla ${n} ${/^aprobar/i.test(m[1]) ? 'aprobada: el agente ya la usa.' : 'rechazada.'}`);
    }
    return reply('No entendí. Escribe ayuda para ver los comandos.');
  }

  // ---------- Reportes ----------
  function agendaText() {
    const today = localDate(new Date(), cfg.tz);
    const rows = db.all('SELECT * FROM leads WHERE call_start IS NOT NULL ORDER BY call_start').filter((l) => localDate(l.call_start, cfg.tz) === today);
    if (!rows.length) return 'Hoy no tienes llamadas agendadas.';
    return rows.map((l) => `${when(l.call_start).time} · ${l.name} · ${STATUS[l.status] || l.status}${investPhrase(l.invest) ? ` · ${l.invest}` : ''}`).join('\n\n');
  }
  async function maybeDailyReport() {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: cfg.tz }).format(new Date());
    const today = localDate(new Date(), cfg.tz);
    if (parts.startsWith('07') && db.kv('last_report') !== today) {
      db.kv('last_report', today);
      const pend = db.get("SELECT COUNT(*) n FROM approvals WHERE status='pendiente'").n;
      group('reportes', `Buenos días Jorge. Agenda de hoy:\n\n${agendaText()}\n\nAprobaciones pendientes: ${pend}`);
    }
  }

  return { syncCalendar, handleLeadText, handleOwnerText, processFollowups, handleFathomMeeting, maybeDailyReport, agendaText, propose, sendApproval };
}
