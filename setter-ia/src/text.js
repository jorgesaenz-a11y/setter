export const digits = (s = '') => String(s).replace(/\D/g, '');

// Devuelve el teléfono con indicativo de país, solo dígitos, o null.
export function normPhone(raw, cc = '57') {
  if (!raw) return null;
  const plus = /^\s*\+/.test(raw);
  let d = digits(raw);
  if (!d) return null;
  if (plus) return d.length >= 8 ? d : null;
  if (d.startsWith('00')) return d.slice(2);
  if (d.length === 10 && d.startsWith('3')) return cc + d;   // celular colombiano
  if (d.length >= 11) return d;                              // ya trae indicativo
  return null;
}

export const norm = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const DOUBLE_NAMES = new Set(['juan', 'maria', 'luisa', 'ana', 'jose', 'carlos', 'luis', 'andres', 'diego', 'miguel', 'jorge']);
export function firstName(full = '') {
  const w = full.trim().split(/\s+/);
  if (w.length >= 3 && DOUBLE_NAMES.has(norm(w[0]))) return `${w[0]} ${w[1]}`;
  return w[0] || '';
}

export function fmtWhen(date, tz) {
  const d = new Date(date);
  const wd = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: tz }).format(d);
  const day = new Intl.DateTimeFormat('es-CO', { day: 'numeric', timeZone: tz }).format(d);
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const ap = get('dayPeriod').toLowerCase().startsWith('a') ? 'a.m.' : 'p.m.';
  return { day: `${wd} ${day}`, time: `${get('hour')}:${get('minute')} ${ap}` };
}

export const localDate = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(d)); // YYYY-MM-DD

// Estilo obligatorio: sin signos de apertura y doble espacio entre párrafos.
export function sanitize(t = '') {
  return String(t).replace(/[¿¡]/g, '').replace(/\r/g, '').replace(/\b([ap]\.m\.)\./gi, '$1')
    .split(/\n+/).map((s) => s.trim()).filter(Boolean).join('\n\n').trim();
}

const BANNED = [
  [/perder (tu |el )?tiempo/i, 'frase "perder tiempo"'],
  [/solo en esta llamada/i, 'urgencia falsa'],
  [/dejamos pasar/i, 'presión'],
  [/21\.?000 usuarios|21 mil/i, 'mención de los 21.000 usuarios'],
  [/garantizo/i, 'promesa de garantía'],
  [/(seguro|segura) de que (vas|empiezas|tendr)/i, 'promesa de resultados'],
];
export function issues(t = '') {
  const out = [];
  for (const [re, why] of BANNED) if (re.test(t)) out.push(why);
  const sinSaludo = t.replace(/c[oó]mo est[aá]s\?/gi, '');   // el saludo no cuenta como pregunta
  if ((sinSaludo.match(/\?/g) || []).length > 1) out.push('más de una pregunta');
  if (/[¿¡]/.test(t)) out.push('signos de apertura');
  return out;
}

export function investPhrase(inv) {
  if (!inv) return null;
  const s = inv.trim();
  if (/^m[aá]s de/i.test(s)) return `de ${s.charAt(0).toLowerCase()}${s.slice(1)} al mes`;
  const m = s.match(/(\$[\d.]+)\s*a\s*(\$[\d.]+)/i);
  if (m) return `entre ${m[1]} y ${m[2]} USD al mes`;
  return null;
}

export function parseApproval(t = '') {
  const s = t.trim();
  let m = s.match(/^(?:ok|si|sí|aprobar|enviar)\s*#?(\d+)?$/i);
  if (m) return { action: 'ok', id: m[1] ? Number(m[1]) : null };
  m = s.match(/^(?:no|rechazar|descartar)\s*#?(\d+)?$/i);
  if (m) return { action: 'no', id: m[1] ? Number(m[1]) : null };
  m = s.match(/^editar\s*#?(\d+)\s*:\s*([\s\S]+)$/i);
  if (m) return { action: 'edit', id: Number(m[1]), text: m[2] };
  return null;
}

export function openingMessage({ name, agent, when, invest }) {
  const f = firstName(name);
  const inv = investPhrase(invest);
  const parts = [
    `Hola ${f}, cómo estás?`,
    `Soy ${agent}, asistente IA de Jorge Sáenz, Consultor Senior de SaleADS.`,
    `Tienes agendada una llamada con Jorge el ${when.day} a las ${when.time}. Quería confirmarte que sigue en pie, será una buena oportunidad para analizar tu negocio y ver cómo hacerlo crecer con anuncios con IA.`,
  ];
  if (inv) parts.push(`Vi que en tu registro marcaste una inversión en anuncios ${inv}.`);
  parts.push('Para preparar la llamada pensando en tu caso, me cuentas en una línea a qué se dedica tu negocio?');
  return sanitize(parts.join('\n'));
}
