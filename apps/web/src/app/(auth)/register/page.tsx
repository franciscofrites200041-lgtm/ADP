import { messages } from "../../../messages";
import { AuthForm } from "../auth-form";

export default function RegisterPage() {
  return (
    <main>
      <h1>{messages.auth.register.title}</h1>
      <p>{messages.auth.register.description}</p>
      <AuthForm mode="register" />
      <p>{messages.auth.googleDeferred}</p>
    </main>
  );
}
