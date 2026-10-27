"use client";

import { type FormEvent, useState } from "react";

import { messages } from "../../messages";

type AuthMode = "login" | "register" | "forgot-password";

interface AuthFormProps {
  mode: AuthMode;
}

const endpointByMode: Record<AuthMode, string> = {
  login: "/api/auth/sign-in/email",
  register: "/api/auth/sign-up/email",
  "forgot-password": "/api/auth/request-password-reset",
};

const copyByMode = {
  login: messages.auth.login,
  register: messages.auth.register,
  "forgot-password": messages.auth.forgotPassword,
} as const;

export function AuthForm({ mode }: AuthFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const copy = copyByMode[mode];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");

    const payload =
      mode === "register"
        ? { name: formData.get("name"), email, password }
        : mode === "login"
          ? { email, password }
          : { email, redirectTo: "/login" };

    try {
      const response = await fetch(endpointByMode[mode], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setError(messages.auth.errors.submit);
        return;
      }

      if (mode === "forgot-password") {
        setIsSent(true);
        return;
      }

      window.location.assign("/");
    } catch {
      setError(messages.auth.errors.network);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSent) {
    return <p role="status">{messages.auth.forgotPassword.sent}</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      {mode === "register" ? (
        <label>
          {messages.auth.fields.name}
          <input autoComplete="name" name="name" required type="text" />
        </label>
      ) : null}
      <label>
        {messages.auth.fields.email}
        <input autoComplete="email" name="email" required type="email" />
      </label>
      {mode !== "forgot-password" ? (
        <label>
          {messages.auth.fields.password}
          <input
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? messages.auth.submitting : copy.submit}
      </button>
    </form>
  );
}
