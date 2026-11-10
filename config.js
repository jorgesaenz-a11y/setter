import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const digits = (s = '') => String(s).replace(/\D/g, '');
const flag = (k) => (process.env[k] ?? '0') === '1';

export const cfg = {
  root,
  ownerPhone: digits(process.env.OWNER_PHONE),          // tu WhatsApp personal, con indicativo
  defaultCC: process.env.DEFAULT_COUNTRY_CODE || '57',
  tz: process.env.TZ_NAME || 'America/Bogota',
  agentName: process.env.AGENT_NAME || 'Lía',
  icsUrl: process.env.CALENDAR_ICS_URL || '',
  aiProvider: (process.env.AI_PROVIDER || 'anthropic').toLowerCase(),   // anthropic | gemini
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  fathomKey: process.env.FATHOM_API_KEY || '',
  // Agendas anteriores a esta fecha (AAAA-MM-DD) no reciben borrador de apertura: úsalo para los leads que ya contactaste a mano.
  skipOpeningsBefore: process.env.SKIP_OPENINGS_BEFORE ? new Date(`${process.env.SKIP_OPENINGS_BEFORE}T00:00:00-05:00`) : null,
  dryRun: flag('DRY_RUN'),
  fakeAi: flag('FAKE_AI'),
  // Todo en 0 = modo seguro: nada sale sin tu aprobación.
  auto: {
    opening: flag('AUTO_OPENING'),
    reminder: flag('AUTO_REMINDER'),
    reply: flag('AUTO_REPLY'),
    followup: flag('AUTO_FOLLOWUP'),
    postsale: flag('AUTO_POSTSALE'),
  },
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'setter.db'),
  authDir: path.join(dataDir, 'auth'),
  adminKey: process.env.ADMIN_KEY || '',                 // clave para ver el QR en el navegador
  port: Number(process.env.PORT || 3000),
  playbook: path.join(root, 'playbook', 'skill-asistente-ia-jorge-saenz.md'),
  learned: path.join(dataDir, 'aprendizajes.md'),         // en la carpeta de datos para que sobreviva a los reinicios
  proposals: path.join(dataDir, 'propuestas.md'),
};
