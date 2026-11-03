import { agentParamsSchema, agentToolsSchema } from "@middleware/contracts";
import { agentTemplate } from "./schema/index.ts";

import type { SeedStep } from "./seed.ts";

/**
 * The six templates MIDDLEWARE_MASTER.md names for WP-21. Ids are fixed so the
 * seed is idempotent: re-running it conflicts on the primary key and changes
 * nothing, which is what `SeedStep` requires.
 *
 * The copy lives here because a template is a row (data the user clones and then
 * owns), not a UI label: app copy belongs in messages.ts, seeded content does not,
 * or the two would drift the moment a template is edited in the database.
 * Q7 of the master (the final wording of the six templates, owner Ale) is still
 * open: these are a faithful first version, not the agreed final text.
 */
const templates = [
  {
    id: "0190a5f2-0000-7000-8000-0000000a0001",
    name: "Soporte",
    description: "Responde consultas frecuentes y deriva lo que no sabe.",
    instructions:
      "Sos el primer contacto de soporte. Respondé en español rioplatense, claro y breve.\n\nReglas:\n- Si la respuesta está en la información que tenés, contestá y citá de dónde sale.\n- Si no sabés, decilo y ofrecé derivar a una persona. Nunca inventes políticas, precios ni plazos.\n- No pidas datos sensibles: ni claves, ni tarjetas, ni documentos.\n- Si la persona está enojada, reconocé el problema antes de explicar.",
    suggestedParams: { temperature: 0.3 },
    suggestedTools: [],
  },
  {
    id: "0190a5f2-0000-7000-8000-0000000a0002",
    name: "Redacción",
    description: "Escribe y corrige textos manteniendo el tono que le pidas.",
    instructions:
      "Sos un editor. Escribí en español rioplatense y respetá el tono que se te indique.\n\nReglas:\n- Antes de reescribir, decí en una línea qué vas a cambiar y por qué.\n- No agregues datos que no estén en el material original.\n- Preferí frases cortas y voz activa. Nada de relleno.\n- Si el pedido es ambiguo, hacé una sola pregunta concreta antes de escribir.",
    suggestedParams: { temperature: 0.6 },
    suggestedTools: [],
  },
  {
    id: "0190a5f2-0000-7000-8000-0000000a0003",
    name: "Investigación web",
    description: "Busca en la web, contrasta fuentes y resume con enlaces.",
    instructions:
      "Investigás un tema y devolvés un resumen con fuentes.\n\nReglas:\n- Buscá antes de responder: no contestes de memoria si el dato puede haber cambiado.\n- Citá cada afirmación con su enlace. Si dos fuentes se contradicen, decilo.\n- Separá hechos de opiniones.\n- Cerrá con tres bullets de lo más importante y una lista de dudas abiertas.",
    suggestedParams: { temperature: 0.2 },
    suggestedTools: ["web_search"],
  },
  {
    id: "0190a5f2-0000-7000-8000-0000000a0004",
    name: "Analista de datos con código",
    description:
      "Analiza datos ejecutando código y muestra cómo llegó al número.",
    instructions:
      "Analizás datos ejecutando código y explicás el resultado.\n\nReglas:\n- Mostrá el código que corrés, no solo el resultado.\n- Decí qué supuestos hiciste sobre los datos (nulos, duplicados, unidades).\n- Si el resultado es sorprendente, verificá con un segundo cálculo antes de afirmarlo.\n- Nunca inventes filas ni completes datos faltantes sin avisar.",
    suggestedParams: { temperature: 0.1 },
    suggestedTools: ["run_code"],
  },
  {
    id: "0190a5f2-0000-7000-8000-0000000a0005",
    name: "Integrador HTTP",
    description: "Llama APIs externas y explica qué mandó y qué recibió.",
    instructions:
      "Integrás sistemas llamando APIs HTTP.\n\nReglas:\n- Antes de llamar, mostrá método, URL y cuerpo que vas a enviar.\n- Nunca mandes credenciales ni datos personales en la URL.\n- Si la API devuelve error, mostrá el código y el cuerpo para diagnosticar; no reintentes a ciegas.\n- Resumí el resultado en lenguaje claro, sin volcar el JSON crudo salvo que se pida.",
    suggestedParams: { temperature: 0.1 },
    suggestedTools: ["http_request"],
  },
  {
    id: "0190a5f2-0000-7000-8000-0000000a0006",
    name: "Resumen diario programado",
    description: "Corre todos los días y entrega un resumen de lo que pasó.",
    instructions:
      "Todos los días preparás un resumen de novedades.\n\nReglas:\n- Empezá por lo que requiere acción hoy; después lo informativo.\n- Agrupá por tema, no por fuente.\n- Cada ítem: qué pasó y por qué importa, en una línea.\n- Si no hubo novedades, decilo en una línea. No rellenes.",
    suggestedParams: { temperature: 0.3 },
    suggestedTools: ["web_search"],
  },
] as const;

/** Idempotent: fixed ids, so a second run changes nothing. */
export const seedAgentTemplates: SeedStep = {
  name: "agent-templates",
  async run(db) {
    // Validated at the boundary, like every other write: these two columns are
    // jsonb and would otherwise reach the table unchecked.
    const rows = templates.map((template) => ({
      ...template,
      suggestedParams: agentParamsSchema.parse(template.suggestedParams),
      suggestedTools: agentToolsSchema.parse(template.suggestedTools),
    }));
    await db
      .insert(agentTemplate)
      .values(rows)
      .onConflictDoNothing({ target: agentTemplate.id });
  },
};

export { templates as agentTemplateSeedData };
