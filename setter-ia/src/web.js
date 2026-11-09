import http from 'node:http';
import QRCode from 'qrcode';

const page = (body, refresh = false) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="15">' : ''}<title>Setter IA</title></head><body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px;text-align:center">${body}</body></html>`;

// Panel mínimo: muestra el QR para vincular WhatsApp desde el navegador (protegido con ADMIN_KEY).
export function startWeb({ cfg, state }) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/health') { res.end('ok'); return; }
    if (u.pathname === '/qr') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (!cfg.adminKey || u.searchParams.get('key') !== cfg.adminKey) { res.statusCode = 403; res.end(page('<p>Clave incorrecta.</p>')); return; }
      if (state.connected) { res.end(page('<h2>WhatsApp conectado</h2><p>No necesitas escanear nada.</p>')); return; }
      if (!state.qr) { res.end(page('<p>Aún no hay código QR. Esta página se recarga sola.</p>', true)); return; }
      const img = await QRCode.toDataURL(state.qr, { margin: 2, width: 340 });
      res.end(page(`<h2>Vincula WhatsApp</h2><p>Escanéalo con el WhatsApp Business del segundo número.</p><img src="${img}" width="340" alt="QR">`, true));
      return;
    }
    res.statusCode = 404; res.end('No encontrado');
  });
  srv.listen(cfg.port, '0.0.0.0', () => console.log(`Panel web listo en el puerto ${cfg.port}`));
  return srv;
}
