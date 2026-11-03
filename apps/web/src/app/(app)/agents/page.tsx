import { getTranslations } from "next-intl/server";

import { AgentsScreen } from "./agents-screen.tsx";

export default async function AgentsPage() {
  const t = await getTranslations("agents");
  return (
    <div className="space-y-4">
      <header className="space-y-1 px-1">
        <h1 className="text-page font-medium tracking-tight text-ink">
          {t("title")}
        </h1>
        <p className="text-small text-ink-2">{t("intro")}</p>
      </header>
      <AgentsScreen />
    </div>
  );
}
