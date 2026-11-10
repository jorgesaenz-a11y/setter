const BASE = 'https://api.fathom.ai/external/v1/meetings';

export async function pollFathom({ cfg, db, app }) {
  if (!cfg.fathomKey) return;
  const since = db.kv('fathom_since') || new Date(Date.now() - 24 * 3600e3).toISOString();
  let cursor = null;
  do {
    const url = new URL(BASE);
    url.searchParams.set('created_after', since);
    url.searchParams.set('include_summary', 'true');
    url.searchParams.set('include_action_items', 'true');
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await fetch(url, { headers: { 'X-Api-Key': cfg.fathomKey } });
    if (!r.ok) throw new Error(`Fathom respondió ${r.status}`);
    const data = await r.json();
    for (const m of data.items || []) {
      const key = `fathom:${m.recording_id ?? m.url}`;
      if (db.kv(key)) continue;
      if (await app.handleFathomMeeting(m)) db.kv(key, '1');
    }
    cursor = data.next_cursor || null;
  } while (cursor);
  db.kv('fathom_since', new Date(Date.now() - 24 * 3600e3).toISOString()); // ventana de 24 h para reintentar los que aún no tienen resumen
}
