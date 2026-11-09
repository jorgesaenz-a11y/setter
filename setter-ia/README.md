# Setter IA de Jorge Sáenz

Asistente que lee tu Google Calendar, escribe a cada lead como un setter por WhatsApp Business (conectado por QR a un SEGUNDO número), te pide aprobación por WhatsApp y te reporta en tres grupos.

## Qué hace la versión 1
- Detecta agendas nuevas, cambios y cancelaciones del calendario y te avisa en el grupo **Confirmaciones IA**.
- Redacta el mensaje de pre-call de cada lead y te lo manda a tu WhatsApp personal para aprobarlo (ok 3, no 3, editar 3: texto).
- Atiende las respuestas de los leads con el playbook (`playbook/skill-asistente-ia-jorge-saenz.md`): una pregunta por mensaje, sin signos de apertura, párrafos con doble espacio.
- Envía recordatorios (24 h y 2 h antes), seguimientos si no compró (2 h, 48 h, 6 días) y postventa (hoy, 24 h, 7 y 30 días), siempre como borradores para tu aprobación.
- Después de cada llamada pregunta en el grupo **Pagos IA** si pagó. Lee el resumen de Fathom y te sugiere el resultado.
- Reporte diario a las 7:00 a.m. en el grupo **Reportes IA** y aviso cuando alguien pide hablar con una persona.
- Solo escribe a números que están en tu calendario o que tú agregas con `ia 3001234567 Nombre`. Ignora y no guarda ningún otro chat.

## Qué NO hace todavía
- No entiende audio, imágenes ni video: te avisa para que lo veas tú.
- No envía links de pago ni da descuentos: eso lo haces tú.
- No sabe solo si alguien pagó: tú respondes "pagó Nombre" o "no pagó Nombre".
- El calendario se lee por la URL secreta iCal de Google, que puede tardar un poco en reflejar cambios.

## Puesta en marcha
1. **Segundo número:** instala WhatsApp Business en un número nuevo (el principal NO se conecta).
2. **Servidor:** cualquier VPS básico o un computador siempre encendido con Node.js 22.13 o superior.
3. **Calendario:** Google Calendar > Configuración > tu calendario > "Dirección secreta en formato iCal". Cópiala.
4. **Claves:** crea una clave de API en Anthropic y otra en Fathom (Configuración > Integraciones > API).
5. Copia `.env.example` a `.env` y llénalo (OWNER_PHONE es tu WhatsApp personal).
6. `npm install` (necesita Git instalado: git-scm.com)
7. Prueba sin conectar nada: `npm test` y `npm run demo`.
8. `npm start`. Escanea el QR con el WhatsApp Business del segundo número (Ajustes > Dispositivos vinculados).
9. El agente crea los grupos Reportes IA, Confirmaciones IA y Pagos IA y te mete en ellos. Escríbele "ayuda" desde tu número personal.
10. Déjalo en modo seguro unos días. Cuando confíes, activa de a uno: `AUTO_REMINDER=1`, luego `AUTO_OPENING=1`, etc.
11. Para que corra 24/7: `npm i -g pm2 && pm2 start src/index.js --name setter-ia && pm2 save && pm2 startup`.

## Instalación en la nube (Railway), sin terminal
1. Crea una cuenta gratis en github.com y un repositorio **privado**. Con "Add file > Upload files", arrastra el contenido de la carpeta setter-ia (NO subas el archivo .env ni la carpeta node_modules).
2. Crea una cuenta en railway.com (plan Hobby, desde 5 dólares al mes). New Project > Deploy from GitHub repo y elige tu repositorio. Railway lo construye solo con el Dockerfile.
3. En el servicio: Settings > Volumes > agrega un volumen montado en `/app/data` (guarda la sesión de WhatsApp y tu base de datos).
4. En Variables, agrega lo mismo que iría en el `.env`: OWNER_PHONE, CALENDAR_ICS_URL, ANTHROPIC_API_KEY, FATHOM_API_KEY, SKIP_OPENINGS_BEFORE y ADMIN_KEY (inventa una clave larga).
5. Settings > Networking > Generate Domain. Abre `https://TU-DOMINIO/qr?key=TU_ADMIN_KEY` y escanea el QR con el WhatsApp Business del segundo número.
6. Listo: el agente crea los grupos y empieza a funcionar. No vuelvas a escanear mientras el volumen exista.

## Si ya escribiste a mano a algunos leads
Pon en `.env` la fecha desde la que quieres que el agente redacte aperturas, por ejemplo `SKIP_OPENINGS_BEFORE=2026-11-14`. Esos leads quedan registrados (con recordatorios y respuestas), pero no reciben otra apertura. El agente no conoce lo que escribiste a mano: si ya estás en una conversación, usa `humano Nombre` para mantenerla contigo.

## Comandos (desde tu WhatsApp personal)
ok 12 · no 12 · editar 12: texto · pendientes · hoy · estado · pagó Nombre · no pagó Nombre · ia 3001234567 Nombre · humano Nombre · ia Nombre · pausar · reanudar · aprender: regla · aprobar regla 3 · rechazar regla 3

## Riesgos que debes conocer
- Conectar por QR no es la vía oficial de WhatsApp: el número puede ser bloqueado. Por eso se usa un segundo número, solo para personas con llamada agendada, con pausas entre mensajes y sin envíos masivos.
- Si el sistema te muestra identificadores @lid en lugar de teléfonos, agrega OWNER_LID al `.env` como indica el aviso.
- Los datos de los leads son de SaleADS: confirma con tu equipo que puedes guardarlos y enviarlos a un servicio de IA.
- Lo que el agente "aprende" solo se agrega al playbook cuando tú escribes `aprobar regla N`.
