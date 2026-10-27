import { createTransport } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Transactional email boundary (Q3); adapters are injected, never global. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Default adapter: SMTP over `SMTP_URL`. Credentials stay inside the transport. */
export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport(smtpUrl);
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
