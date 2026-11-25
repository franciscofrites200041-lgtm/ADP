import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { ChatScreen } from "./chat-screen.tsx";

type ChatPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Every id in the address must be a uuid (S11): anything else is treated as
 * absent, so a hand-edited URL cannot feed a malformed id to the API.
 */
const readId = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && z.uuid().safeParse(value).success ? value : null;

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const t = await getTranslations("chat");
  const params = await searchParams;
  return (
    <div className="space-y-4">
      <header className="space-y-1 px-1">
        <h1 className="text-page font-medium tracking-tight text-ink">
          {t("title")}
        </h1>
        <p className="text-small text-ink-2">{t("intro")}</p>
      </header>
      <ChatScreen
        initialAgent={readId(params.agent)}
        initialConversation={readId(params.conversation)}
        initialRun={readId(params.run)}
      />
    </div>
  );
}
