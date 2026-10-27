import { messages } from "../../../messages";
import { AuthForm } from "../auth-form";

export default function ForgotPasswordPage() {
  return (
    <main>
      <h1>{messages.auth.forgotPassword.title}</h1>
      <p>{messages.auth.forgotPassword.description}</p>
      <AuthForm mode="forgot-password" />
    </main>
  );
}
