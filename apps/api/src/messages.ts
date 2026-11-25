import type { ErrorCode, RunEvent } from "@middleware/contracts";

/** User-facing error messages (§10): Spanish and safe to show. */
export const errorMessages: Record<ErrorCode, string> = {
  invalid_request: "Revisá los datos que mandaste.",
  unauthorized: "Tenés que iniciar sesión.",
  not_found: "No encontramos lo que buscás.",
  alias_taken: "Ya tenés una credencial con ese alias.",
  forbidden: "No pudimos verificar el origen del pedido.",
  unknown: "Algo salió mal. Probá de nuevo en un rato.",
};

/** The engine emits only the code; the Spanish copy lives here (WP-33). */
type RunFailedEvent = Extract<RunEvent, { type: "run.failed" }>;
export type RunFailureCode = RunFailedEvent["code"];

/** Every provider and engine failure code of §10, in Rioplatense Spanish. */
export const runFailureMessages: Record<RunFailureCode, string> = {
  invalid_api_key:
    "La credencial del modelo no es válida. Revisá la API key del agente.",
  insufficient_quota:
    "La cuenta del proveedor no tiene crédito suficiente para este modelo.",
  rate_limited:
    "El proveedor está recibiendo demasiados pedidos. Probá de nuevo en un rato.",
  model_not_found:
    "El modelo que pide el agente no está disponible en el proveedor.",
  context_too_long:
    "La conversación se hizo muy larga para este modelo. Empezá una conversación nueva.",
  provider_timeout:
    "El proveedor tardó demasiado en responder. Probá de nuevo.",
  provider_unavailable:
    "El proveedor no está disponible en este momento. Probá de nuevo en un rato.",
  content_filtered:
    "El proveedor bloqueó la respuesta por su política de contenido.",
  tool_failed: "Una herramienta del agente falló a mitad de la ejecución.",
  run_timeout: "La ejecución tardó demasiado y se cortó. Probá de nuevo.",
  limit_reached: "Alcanzaste el límite de uso de tu plan.",
  integration_needs_reauth:
    "Una integración del agente necesita que la vuelvas a conectar.",
  delivery_failed: "No pudimos entregar el mensaje por el canal configurado.",
  unknown: "La ejecución falló. Probá de nuevo en un rato.",
};

/** For a code with no entry: never the raw code, never provider text. */
export const runFailureFallbackMessage =
  "Algo falló durante la ejecución. Probá de nuevo en un rato.";

/** The Spanish sentence of a `run.failed` code, with a safe generic fallback. */
export const runFailureMessage = (code: string): string =>
  Object.hasOwn(runFailureMessages, code)
    ? runFailureMessages[code as RunFailureCode]
    : runFailureFallbackMessage;
