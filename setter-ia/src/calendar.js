import ical from 'node-ical';

const val = (x) => (x && typeof x === 'object' && 'val' in x ? x.val : x) ?? '';

export function parseDescription(desc = '') {
  const get = (re) => (String(desc).match(re) || [])[1]?.trim() || null;
  return {
    phone: get(/Phone:-?\s*([^\n\r]*)/i),
    email: get(/Email:-?\s*([^\s\n\r]*)/i),
    invest: get(/Inversi[oó]n en ads\/mes:\s*([^\n\r]*)/i),
    source: get(/Fuente:\s*([^\n\r]*)/i),
    reschedule: get(/Reschedule:-?\s*(https?:\/\/\S+)/i),
  };
}

export function nameFromSummary(s = '') {
  return String(s).replace(/^GENIA\s*[·•\-–]\s*/i, '').replace(/\s+X\s+SaleADS.*$/i, '').trim();
}

export function toLeadEvent(ev) {
  const summary = String(val(ev.summary));
  const desc = String(val(ev.description));
  const d = parseDescription(desc);
  const isLead = /saleads/i.test(summary) || !!d.phone;
  return {
    isLead, uid: String(ev.uid || ''), name: nameFromSummary(summary), summary,
    start: new Date(ev.start), end: new Date(ev.end || ev.start), ...d,
    cancelled: String(ev.status || '').toUpperCase() === 'CANCELLED',
  };
}

// Carga eventos desde la URL secreta iCal de Google Calendar (o desde un texto, para pruebas).
export async function loadEvents({ url, icsText, from, to }) {
  const data = icsText ? ical.parseICS(icsText) : await ical.async.fromURL(url);
  return Object.values(data)
    .filter((e) => e.type === 'VEVENT' && e.start)
    .map(toLeadEvent)
    .filter((e) => e.isLead && !e.cancelled && (!from || e.start >= from) && (!to || e.start <= to));
}
