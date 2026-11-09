import test from 'node:test';
import assert from 'node:assert/strict';
import { normPhone, sanitize, issues, parseApproval, investPhrase, openingMessage, firstName } from '../src/text.js';

test('normaliza teléfonos', () => {
  assert.equal(normPhone('300 3185939'), '573003185939');
  assert.equal(normPhone('+507 6795-4496'), '50767954496');
  assert.equal(normPhone('+1 323-320-0302'), '13233200302');
  assert.equal(normPhone('+506 8802 0801'), '50688020801');
  assert.equal(normPhone(''), null);
});

test('sanitize quita signos de apertura y deja doble espacio', () => {
  const out = sanitize('Hola ¿cómo estás?\nSoy Lía.\n\n\nTe cuento ¡algo!');
  assert.ok(!/[¿¡]/.test(out));
  assert.equal(out, 'Hola cómo estás?\n\nSoy Lía.\n\nTe cuento algo!');
});

test('detecta frases no permitidas y varias preguntas', () => {
  assert.ok(issues('No quiero hacerte perder tiempo').length);
  assert.ok(issues('Esto es solo en esta llamada').length);
  assert.ok(issues('Cuánto vendes? Y cuánto inviertes?').includes('más de una pregunta'));
  assert.deepEqual(issues('Hola, cómo estás?'), []);
});

test('aprobaciones', () => {
  assert.deepEqual(parseApproval('ok 12'), { action: 'ok', id: 12 });
  assert.deepEqual(parseApproval('no 3'), { action: 'no', id: 3 });
  assert.deepEqual(parseApproval('Editar 5: Hola Juan'), { action: 'edit', id: 5, text: 'Hola Juan' });
  assert.equal(parseApproval('no pagó juan'), null);
});

test('frase de inversión y nombre', () => {
  assert.equal(investPhrase('$1.000 a $3.000 USD'), 'entre $1.000 y $3.000 USD al mes');
  assert.equal(investPhrase('Más de $5.000 USD'), 'de más de $5.000 USD al mes');
  assert.equal(firstName('Juan Felipe Arboleda'), 'Juan Felipe');
  assert.equal(firstName('Natalia Archila'), 'Natalia');
});

test('mensaje de apertura cumple el estilo', () => {
  const m = openingMessage({ name: 'Veronica Arboleda', agent: 'Lía', when: { day: 'jueves 12', time: '9:30 a.m.' }, invest: '$1.000 a $3.000 USD' });
  assert.deepEqual(issues(m), []);
  assert.ok(m.includes('asistente IA de Jorge Sáenz, Consultor Senior de SaleADS'));
  assert.ok(m.includes('\n\n'));
  assert.ok(!/perder/i.test(m));
});
