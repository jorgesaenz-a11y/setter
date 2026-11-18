import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { normPhone } from './text.js';

const page = (body, refresh = false) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="15">' : ''}<title>Setter IA</title></head><body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px;text-align:center">${body}</body></html>`;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

export function startWeb({ cfg, state, db, app, wa }) {
  const token = cfg.adminKey ? sha(`${cfg.adminKey}|setter`) : null;
  const authed = (req, u) => {
    if (!token) return false;
    if (u.searchParams.get('key') === cfg.adminKey) return 'key';
    return (req.headers.cookie || '').split(/;\s*/).includes(`adm=${token}`);
  };
  const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); };
  const leadOut = (l) => ({ ...l, tags: app.tagsOf(l), agent_enabled: l.agent_enabled !== 0 });
  const panelFile = new URL('./panel.html', import.meta.url);

  const srv = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      const p = u.pathname;
      if (p === '/health') return void res.end('ok');
      const a = authed(req, u);
      if (p === '/qr') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (!a) { res.statusCode = 403; return void res.end(page('<p>Clave incorrecta.</p>')); }
        if (state.connected) return void res.end(page('<h2>WhatsApp conectado</h2><p>No necesitas escanear nada.</p><p><a href="/panel">Ir al panel</a></p>'));
        if (!state.qr) return void res.end(page('<p>Aún no hay código QR. Esta página se recarga sola.</p>', true));
        const img = await QRCode.toDataURL(state.qr, { margin: 2, width: 340 });
        return void res.end(page(`<h2>Vincula WhatsApp</h2><p>Escanéalo con el WhatsApp Business del segundo número.</p><img src="${img}" width="340" alt="QR">`, true));
      }
      if (p === '/panel') {
        if (!a) { res.statusCode = 403; res.setHeader('content-type', 'text/html; charset=utf-8'); return void res.end(page('<p>Entra con el enlace /panel?key=TU_CLAVE</p>')); }
        if (a === 'key') res.setHeader('set-cookie', `adm=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return void res.end(fs.readFileSync(panelFile));
      }
      if (!p.startsWith('/api/')) { res.statusCode = 404; return void res.end('No encontrado'); }
      if (!a) return json(res, { error: 'no autorizado' }, 401);
      const body = req.method === 'POST' ? await readBody(req) : {};

      if (p === '/api/state') {
        const c = (sql) => db.get(sql).n;
        return json(res, {
          connected: state.connected, paused: app.isPaused(), agent: cfg.agentName, ai: cfg.fakeAi ? 'prueba (sin clave de IA)' : cfg.aiProvider,
          calendar: !!cfg.icsUrl, fathom: !!cfg.fathomKey,
          auto: Object.fromEntries(app.AUTO_KEYS.map((k) => [k, app.isAuto(k)])),
          leads: c('SELECT COUNT(*) n FROM leads'), pending: c("SELECT COUNT(*) n FROM approvals WHERE status='pendiente'"),
          groups: ['reportes', 'confirmaciones', 'pagos'].map((k) => ({ key: k, ok: !!db.kv(`group:${k}`) })),
        });
      }
      if (p === '/api/leads') {
        const rows = db.all(`SELECT l.*, (SELECT text FROM messages m WHERE m.phone=l.phone ORDER BY id DESC LIMIT 1) last_text,
          (SELECT ts FROM messages m WHERE m.phone=l.phone ORDER BY id DESC LIMIT 1) last_ts FROM leads l ORDER BY COALESCE(last_ts, l.created_at) DESC`);
        return json(res, { statuses: app.STATUS, leads: rows.map(leadOut) });
      }
      if (p === '/api/agenda') {
        const rows = db.all('SELECT * FROM leads WHERE call_start IS NOT NULL ORDER BY call_start');
        return json(res, { statuses: app.STATUS, leads: rows.map(leadOut) });
      }
      if (p === '/api/approvals') {
        const rows = db.all("SELECT a.*, l.name FROM approvals a LEFT JOIN leads l ON l.phone=a.phone WHERE a.status='pendiente' ORDER BY a.id");
        return json(res, { kinds: app.KIND, approvals: rows });
      }
      if (p === '/api/approvals/act') {
        const id = Number(body.id);
        if (body.action === 'no') { db.run("UPDATE approvals SET status='descartado' WHERE id=? AND status='pendiente'", id); return json(res, { ok: true }); }
        const ok = await app.sendApproval(id, body.text || undefined);
        return json(res, { ok });
      }
      let m;
      if ((m = p.match(/^\/api\/lead\/(\d+)$/))) {
        const l = db.leadByPhone(m[1]);
        if (!l) return json(res, { error: 'no existe' }, 404);
        if (req.method === 'POST') {
          if ('agent_enabled' in body) db.run('UPDATE leads SET agent_enabled=? WHERE phone=?', body.agent_enabled ? 1 : 0, l.phone);
          if ('tags' in body) db.run('UPDATE leads SET tags=? WHERE phone=?', (body.tags || []).map((t) => String(t).trim()).filter(Boolean).join(','), l.phone);
          if ('status' in body && app.STATUS[body.status]) db.run('UPDATE leads SET status=? WHERE phone=?', body.status, l.phone);
          if ('notes' in body) db.run('UPDATE leads SET notes=? WHERE phone=?', String(body.notes), l.phone);
          if ('name' in body && String(body.name).trim()) db.run('UPDATE leads SET name=? WHERE phone=?', String(body.name).trim(), l.phone);
        }
        return json(res, { lead: leadOut(db.leadByPhone(l.phone)), messages: db.history(l.phone, 200) });
      }
      if ((m = p.match(/^\/api\/lead\/(\d+)\/send$/))) {
        const ok = await app.sendManual(m[1], String(body.text || ''));
        return json(res, { ok });
      }
      if ((m = p.match(/^\/api\/lead\/(\d+)\/payment$/))) return json(res, { ok: app.payByPhone(m[1], !!body.paid) });
      if (p === '/api/lead/create') {
        const phone = normPhone(body.phone, cfg.defaultCC);
        if (!phone) return json(res, { error: 'teléfono inválido' }, 400);
        const name = String(body.name || '').trim() || phone;
        db.run("INSERT INTO leads(phone,name,status,ai_tag) VALUES(?,?, 'seguimiento',1) ON CONFLICT(phone) DO UPDATE SET ai_tag=1, name=excluded.name", phone, name);
        return json(res, { ok: true, phone });
      }
      if (p === '/api/sync') { await app.syncCalendar(); return json(res, { ok: true }); }
      if (p === '/api/instructions') {
        if (req.method === 'POST') {
          if (!String(body.text || '').trim()) return json(res, { error: 'vacío' }, 400);
          if (fs.existsSync(cfg.playbookData)) fs.copyFileSync(cfg.playbookData, `${cfg.playbookData}.bak`);
          fs.writeFileSync(cfg.playbookData, body.text);
          return json(res, { ok: true });
        }
        return json(res, { text: fs.existsSync(cfg.playbookData) ? fs.readFileSync(cfg.playbookData, 'utf8') : fs.readFileSync(cfg.playbook, 'utf8') });
      }
      if (p === '/api/instructions/restore') { fs.copyFileSync(cfg.playbook, cfg.playbookData); return json(res, { ok: true }); }
      if (p === '/api/settings') {
        if ('paused' in body) db.kv('paused', body.paused ? '1' : '0');
        if (body.auto) for (const [k, v] of Object.entries(body.auto)) app.setAuto(k, !!v);
        return json(res, { ok: true });
      }
      if (p === '/api/groups') { await wa.ensureGroups?.(); return json(res, { ok: true }); }
      return json(res, { error: 'no encontrado' }, 404);
    } catch (e) { console.error('[web]', e.message); json(res, { error: e.message }, 500); }
  });
  srv.listen(cfg.port, '0.0.0.0', () => console.log(`Panel web listo en el puerto ${cfg.port}`));
  return srv;
}
