import type { Mailer } from "./mailer.ts";

interface AuthEmailPayload {
  user: { email: string };
  url: string;
}

/**
 * Builds the Better Auth email callbacks on top of a `Mailer`. Sending is not
 * awaited (avoids revealing whether an account exists through response timing)
 * and failures are logged with a fixed message: never the url, token, or error.
 */
export function createAuthEmailCallbacks(mailer: Mailer) {
  const dispatch = (to: string, subject: string, text: string): void => {
    mailer.send({ to, subject, text }).catch(() => {
      console.error("auth email delivery failed");
    });
  };
  return {
    sendVerificationEmail: async ({ user, url }: AuthEmailPayload) => {
      dispatch(
        user.email,
        "Confirmá tu email",
        `Confirmá tu email ingresando a este enlace:\n${url}`,
      );
    },
    sendResetPassword: async ({ user, url }: AuthEmailPayload) => {
      dispatch(
        user.email,
        "Restablecé tu contraseña",
        `Para elegir una nueva contraseña ingresá a este enlace:\n${url}\nSi no lo pediste vos, ignorá este mensaje.`,
      );
    },
  };
}
