import { Card, IconTile, RaisedRow } from "@middleware/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

const sections = [
  "agents",
  "groups",
  "chats",
  "providers",
  "tools",
  "schedules",
  "approvals",
  "runs",
  "usage",
  "settings",
] as const;

const sectionSchema = z.enum(sections);

type Section = z.infer<typeof sectionSchema>;

const actionPath: Record<Section, string> = {
  agents: "/agents",
  groups: "/groups",
  chats: "/agents",
  providers: "/providers",
  tools: "/tools",
  schedules: "/schedules",
  approvals: "/runs",
  runs: "/agents",
  usage: "/agents",
  settings: "/",
};

export default async function EmptySectionPage({
  params,
}: Readonly<{ params: Promise<{ section: string }> }>) {
  const { section } = await params;
  const parsedSection = sectionSchema.safeParse(section);
  if (!parsedSection.success) {
    notFound();
  }

  const t = await getTranslations(`emptyPages.${parsedSection.data}`);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-3xl items-center">
      <Card className="w-full p-8 text-center sm:p-12">
        <IconTile
          className="mx-auto text-heading"
          role="img"
          aria-label={t("title")}
        >
          +
        </IconTile>
        <h1 className="mt-6 text-page font-medium">{t("title")}</h1>
        <RaisedRow className="mx-auto mt-6 max-w-xl">
          <h2 className="text-title font-semibold">{t("emptyTitle")}</h2>
          <p className="mt-2 text-body text-muted">{t("description")}</p>
          <Link
            className="mt-5 inline-flex min-h-11 items-center rounded-field bg-accent px-4 text-body font-semibold text-on-accent shadow-accent"
            href={actionPath[parsedSection.data]}
          >
            {t("action")}
          </Link>
        </RaisedRow>
      </Card>
    </div>
  );
}
