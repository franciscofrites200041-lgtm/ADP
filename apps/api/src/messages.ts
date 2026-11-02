import type { ErrorCode } from "@middleware/contracts";

/** User-facing error messages (§10): Spanish and safe to show. */
export const errorMessages: Record<ErrorCode, string> = {
  invalid_request: "Revisá los datos que mandaste.",
  unauthorized: "Tenés que iniciar sesión.",
  not_found: "No encontramos lo que buscás.",
  alias_taken: "Ya tenés una credencial con ese alias.",
  unknown: "Algo salió mal. Probá de nuevo en un rato.",
};
