import { messages } from "../messages";

export default function HomePage() {
  return (
    <main>
      <h1>{messages.home.title}</h1>
      <p>{messages.home.description}</p>
    </main>
  );
}
