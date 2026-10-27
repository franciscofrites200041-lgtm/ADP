import { messages } from "../../../messages";
import { AuthForm } from "../auth-form";

export default function LoginPage() {
  return (
    <main>
      <h1>{messages.auth.login.title}</h1>
      <p>{messages.auth.login.description}</p>
      <AuthForm mode="login" />
      <p>{messages.auth.googleDeferred}</p>
    </main>
  );
}
