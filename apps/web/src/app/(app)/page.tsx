import {
  Card,
  Composer,
  DarkPanel,
  FlowConnector,
  FlowNode,
  RaisedRow,
} from "@middleware/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("home");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-heading font-medium text-ink">
          {t("greeting")},{" "}
          <span className="font-bold">{t("workspaceName")}</span>
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <DarkPanel className="flex min-h-72 flex-col justify-end">
          <h1 className="whitespace-pre-line text-brand font-medium text-on-dark">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-md text-body text-on-dark-2">
            {t("description")}
          </p>
        </DarkPanel>
        <DarkPanel className="flex flex-col justify-center gap-3">
          <h2 className="text-title font-semibold text-on-dark">
            {t("createTitle")}
          </h2>
          <Link
            className="flex min-h-11 items-center rounded-field bg-dark-solid px-4 text-body font-medium text-on-dark"
            href="/agents"
          >
            {t("createAgent")}
          </Link>
          <Link
            className="flex min-h-11 items-center rounded-field bg-dark-solid px-4 text-body font-medium text-on-dark"
            href="/schedules"
          >
            {t("createSchedule")}
          </Link>
          <Link
            className="flex min-h-11 items-center rounded-field bg-dark-solid px-4 text-body font-medium text-on-dark"
            href="/tools"
          >
            {t("createConnection")}
          </Link>
        </DarkPanel>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card aria-labelledby="providers-title">
          <h2 className="text-title font-semibold" id="providers-title">
            {t("providers.title")}
          </h2>
          <RaisedRow className="mt-4">
            <p className="font-medium">{t("providers.emptyTitle")}</p>
            <p className="mt-1 text-small text-muted">
              {t("providers.emptyDescription")}
            </p>
            <Link
              className="mt-3 inline-flex min-h-11 items-center text-small font-semibold text-accent-text"
              href="/providers"
            >
              {t("providers.action")}
            </Link>
          </RaisedRow>
        </Card>
        <Card aria-labelledby="flow-title">
          <h2 className="text-title font-semibold" id="flow-title">
            {t("flow.title")}
          </h2>
          <div className="mt-4 flex flex-col items-center">
            <FlowNode className="w-full justify-center text-small font-medium">
              {t("createAgent")}
            </FlowNode>
            <FlowConnector />
            <FlowNode className="w-full justify-center text-small font-medium">
              {t("createSchedule")}
            </FlowNode>
          </div>
          <p className="mt-4 text-small text-muted">{t("flow.description")}</p>
          <Link
            className="mt-3 inline-flex min-h-11 items-center text-small font-semibold text-accent-text"
            href="/agents"
          >
            {t("flow.action")}
          </Link>
        </Card>
        <Card aria-labelledby="usage-title">
          <h2 className="text-title font-semibold" id="usage-title">
            {t("usage.title")}
          </h2>
          <RaisedRow className="mt-4">
            <p className="font-medium">{t("usage.emptyTitle")}</p>
            <p className="mt-1 text-small text-muted">
              {t("usage.description")}
            </p>
          </RaisedRow>
        </Card>
      </div>
      <Composer
        className="max-w-2xl"
        dictateLabel={t("ask.dictate")}
        inputLabel={t("ask.label")}
        placeholder={t("ask.placeholder")}
        sendLabel={t("ask.send")}
      />
    </div>
  );
}
