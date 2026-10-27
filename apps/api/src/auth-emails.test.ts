import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth.ts";
import { createAuthEmailCallbacks } from "./auth-emails.ts";
import type { Mailer, MailMessage } from "./mailer.ts";

const URL_WITH_TOKEN = "http://localhost:3001/api/auth/reset?token=tok-123";

function fakeMailer() {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    send: async (m) => {
      sent.push(m);
    },
  };
  return { mailer, sent };
}

describe("createAuthEmailCallbacks", () => {
  it("delegates the verification email to the mailer", async () => {
    const { mailer, sent } = fakeMailer();
    await createAuthEmailCallbacks(mailer).sendVerificationEmail({
      user: { email: "ana@example.com" },
      url: URL_WITH_TOKEN,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ana@example.com");
    expect(sent[0]?.text).toContain(URL_WITH_TOKEN);
  });

  it("delegates the reset-password email to the mailer", async () => {
    const { mailer, sent } = fakeMailer();
    await createAuthEmailCallbacks(mailer).sendResetPassword({
      user: { email: "ana@example.com" },
      url: URL_WITH_TOKEN,
    });
    expect(sent[0]?.subject).toBe("Restablecé tu contraseña");
    expect(sent[0]?.text).toContain(URL_WITH_TOKEN);
  });

  it("logs a fixed message on failure, never the url, token, or error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const mailer: Mailer = {
      send: async () => {
        throw new Error("smtp://user:secret@host failed");
      },
    };
    await createAuthEmailCallbacks(mailer).sendResetPassword({
      user: { email: "ana@example.com" },
      url: URL_WITH_TOKEN,
    });
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/tok-123|secret|ana@/);
    error.mockRestore();
  });
});

describe("createAuth email wiring", () => {
  it("sends a verification email on sign-up and a reset email on request", async () => {
    const { mailer, sent } = fakeMailer();
    const table = (): Record<string, unknown>[] => [];
    const auth = createAuth({
      database: memoryAdapter({
        user: table(),
        session: table(),
        account: table(),
        verification: table(),
        organization: table(),
        member: table(),
        invitation: table(),
      }),
      secret: "s".repeat(32),
      baseURL: "http://localhost:3001",
      mailer,
    });
    await auth.api.signUpEmail({
      body: {
        email: "ana@example.com",
        password: "correct-horse-1",
        name: "Ana",
      },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.subject).toBe("Confirmá tu email");

    await auth.api.requestPasswordReset({
      body: { email: "ana@example.com", redirectTo: "http://localhost:3001/" },
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.subject).toBe("Restablecé tu contraseña");
  });
});
