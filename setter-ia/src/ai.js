import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const PURPOSES = {
  reply: 'Responde al último mensaje del lead con una sola pregunta o un solo paso claro.',
  reminder24: 'Escribe un recordatorio corto, 24 horas antes de la llamada, y confirma que sigue en pie.',
  reminder2h: 'Escribe un recordatorio muy corto, 2 horas antes de la llamada, con una frase cálida.',
  followup1: 'Seguimiento 1, unas 2 horas después de la llamada sin compra: resume lo hablado y deja una pregunta.',
  followup2: 'Seguimiento 2, a las 48 horas: aporta un dato nuevo y útil para su negocio y deja una pregunta.',
  followup3: 'Seguimiento 3, entre 5 y 7 días: usa el péndulo ("Si hoy no es el momento, está bien. Qué tendría que pasar para que sí lo fuera?").',
  post_hoy: 'Felicita por la compra confirmada y explica el siguiente paso.',
  post_24h: 'Pregunta cómo va la configuración, 24 horas después de la compra.',
  post_7d: 'Pregunta por los primeros resultados a los 7 días.',
  post_30d: 'Propone una revisión de resultados a los 30 días.',
};

const readSafe = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
export const playbook = (cfg) => `${readSafe(cfg.playbook)}\n\n# Aprendizajes aprobados\n${readSafe(cfg.learned)}`;

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('La IA no devolvió JSON');
  return JSON.parse(m[0]);
}

export function createAi(cfg) {
  const client = cfg.fakeAi ? null : new Anthropic({ apiKey: cfg.anthropicKey });

  async function ask(system, payload, maxTokens = 700) {
    const r = await client.messages.create({
      model: cfg.model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
    return parseJson(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  }

  return {
    async draft({ lead, history, purpose, when }) {
      if (cfg.fakeAi) return { reply: 'Gracias por contarme. Y ya estás usando SaleADS o apenas lo estás conociendo?', needs_human: false, reason: '', intent: 'otro' };
      const system = `${playbook(cfg)}

Eres ${cfg.agentName}. Respondes SOLO con JSON válido, sin texto adicional:
{"reply": "texto para WhatsApp o null", "needs_human": true|false, "reason": "por qué", "intent": "confirma|cancela|reagenda|compra|pide_humano|otro"}
Reglas: una sola pregunta; párrafos separados por una línea en blanco; sin signos de apertura; sin inventar datos; si no estás seguro, pon needs_human en true.`;
      return ask(system, {
        objetivo: PURPOSES[purpose] || PURPOSES.reply, zona_horaria: cfg.tz,
        lead: { nombre: lead.name, estado: lead.status, inversion_declarada: lead.invest, llamada: when, resumen_llamada: lead.summary, enlace_reagendar: lead.reschedule_url },
        conversacion: history.map((h) => ({ de: h.direction === 'in' ? 'lead' : 'asistente', texto: h.text })),
      });
    },
    async classifyCall({ title, summary, actionItems }) {
      if (cfg.fakeAi) return { outcome: 'no_compro', objeciones: ['precio'], siguiente_paso: 'seguimiento', resumen_corto: 'Demo' };
      const system = 'Clasificas llamadas de ventas de SaleADS. Responde SOLO con JSON: {"outcome":"compro|no_compro|pendiente|no_show|incierto","objeciones":["..."],"siguiente_paso":"...","resumen_corto":"2 frases"}. "compro" solo si el resumen indica pago realizado o activación en la llamada; un "sí" verbal sin pago es "pendiente".';
      return ask(system, { titulo: title, resumen: summary, acciones: actionItems }, 400);
    },
  };
}
