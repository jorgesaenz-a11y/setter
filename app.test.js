import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, sampleIcs } from './helpers.js';

const ICS = sampleIcs([
  { uid: 'a', hours: 30, summary: 'GENIA · Juan Felipe Arboleda X SaleADS', description: 'Phone:- 300 3185939\\nEmail:- jf@test.co\\nInversión en ads/mes: $1.000 a $3.000 USD\\nReschedule:- https://example.com/r/1' },
  { uid: 'b', hours: 52, summary: 'Paola Martinez X SaleADS', description: 'Phone:- +507 6795-4496\\nInversión en ads/mes: $200 a $500 USD' },
  { uid: 'c', hours: 60, summary: 'Sin Telefono X SaleADS', description: 'Email:- x@test.co' },
]);

test('el calendario crea leads, borradores y avisos', async () => {
  const { app, db, log } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  assert.equal(db.all('SELECT * FROM leads').length, 2);
  assert.equal(db.all("SELECT * FROM approvals WHERE status='pendiente'").length, 2);
  assert.equal(log.leads.length, 0, 'en modo seguro no se envía nada solo');
  assert.ok(log.owner[0].includes('Aprobación 1'));
  assert.ok(log.groups.some((g) => g.k === 'confirmaciones' && /Nueva agenda/.test(g.t)));
  assert.ok(log.groups.some((g) => /sin teléfono/i.test(g.t)));
});

test('aprobar envía el mensaje y pasa a pre-call', async () => {
  const { app, db, log } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  const replies = [];
  await app.handleOwnerText('ok 1', (t) => replies.push(t));
  assert.equal(log.leads.length, 1);
  assert.equal(log.leads[0].phone, '573003185939');
  assert.equal(db.leadByPhone('573003185939').status, 'precall');
  await app.handleOwnerText('editar 2: Hola Paola cómo estás?', (t) => replies.push(t));
  assert.equal(log.leads.length, 2);
});

test('con AUTO_OPENING la apertura sale sola', async () => {
  const { app, log } = makeApp({ icsText: ICS, auto: { opening: true } });
  await app.syncCalendar();
  assert.equal(log.leads.length, 2);
});

test('una respuesta del lead genera un borrador sin signos de apertura', async () => {
  const { app, db, log } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  await app.handleLeadText('573003185939', 'Tengo una tienda de ropa', 'conversation');
  const ap = db.all("SELECT * FROM approvals WHERE kind='reply'");
  assert.equal(ap.length, 1);
  assert.ok(!/[¿¡]/.test(ap[0].draft));
  assert.ok(log.owner.at(-1).includes('Aprobación'));
});

test('contactos que no están en la lista se ignoran', async () => {
  const { app, db } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  await app.handleLeadText('573999999999', 'hola', 'conversation');
  assert.equal(db.all('SELECT * FROM messages').length, 0);
});

test('pidió no recibir más mensajes', async () => {
  const { app, db } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  await app.handleLeadText('573003185939', 'no me escriban más por favor', 'conversation');
  assert.equal(db.leadByPhone('573003185939').opted_out, 1);
  assert.equal(db.all("SELECT * FROM approvals WHERE kind='reply'").length, 0);
});

test('pagó y no pagó programan lo correcto', async () => {
  const { app, db } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  const out = [];
  await app.handleOwnerText('pagó Juan Felipe', (t) => out.push(t));
  assert.equal(db.leadByPhone('573003185939').status, 'cliente');
  assert.equal(db.all("SELECT * FROM followups WHERE phone='573003185939' AND kind LIKE 'post_%'").length, 4);
  await app.handleOwnerText('no pagó Paola', (t) => out.push(t));
  assert.equal(db.leadByPhone('50767954496').status, 'seguimiento');
  assert.equal(db.all("SELECT * FROM followups WHERE phone='50767954496' AND kind LIKE 'followup%'").length, 3);
});

test('seguimiento vencido genera borrador y solo para quien corresponde', async () => {
  const { app, db } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  await app.handleOwnerText('no pagó Paola', () => {});
  db.run("UPDATE followups SET due_at='2000-01-01T00:00:00.000Z' WHERE kind='followup1'");
  await app.processFollowups();
  assert.equal(db.all("SELECT * FROM approvals WHERE kind='followup1'").length, 1);
});

test('cancelaciones y cambios se detectan', async () => {
  let current = ICS;
  const { app, db, log } = makeApp({ icsText: () => current });
  await app.syncCalendar();
  current = sampleIcs([{ uid: 'a', hours: 35, summary: 'GENIA · Juan Felipe Arboleda X SaleADS', description: 'Phone:- 300 3185939' }]);
  await app.syncCalendar();
  assert.ok(log.groups.some((g) => /Modificó la agenda/.test(g.t)));
  assert.ok(log.groups.some((g) => /Canceló: Paola/.test(g.t)));
  assert.equal(db.leadByPhone('50767954496').status, 'cancelado');
});

test('aprender y aprobar regla', async () => {
  const { app, cfg } = makeApp({ icsText: ICS });
  const out = [];
  await app.handleOwnerText('aprender: Pregunta siempre por el socio al inicio', (t) => out.push(t));
  await app.handleOwnerText('aprobar regla 1', (t) => out.push(t));
  const fs = await import('node:fs');
  assert.ok(fs.readFileSync(cfg.learned, 'utf8').includes('Pregunta siempre por el socio'));
});

test('pausar detiene los envíos automáticos', async () => {
  const { app, log } = makeApp({ icsText: ICS, auto: { opening: true } });
  await app.handleOwnerText('pausar', () => {});
  await app.syncCalendar();
  assert.equal(log.leads.length, 0);
});

test('Fathom: clasifica y pregunta por el pago', async () => {
  const { app, log } = makeApp({ icsText: ICS });
  await app.syncCalendar();
  const ok = await app.handleFathomMeeting({ title: 'Juan Felipe Arboleda X SaleADS', default_summary: { markdown_formatted: 'Resumen' }, action_items: [] });
  assert.equal(ok, true);
  assert.ok(log.groups.some((g) => g.k === 'pagos' && /Pagó\?/.test(g.t)));
});

test('SKIP_OPENINGS_BEFORE evita duplicar aperturas a quienes ya contactaste', async () => {
  const { app, db, cfg } = makeApp({ icsText: ICS });
  cfg.skipOpeningsBefore = new Date(Date.now() + 40 * 3600e3);
  await app.syncCalendar();
  assert.equal(db.all("SELECT * FROM approvals WHERE kind='opening'").length, 1);
  assert.equal(db.leadByPhone('573003185939').status, 'precall');
});
