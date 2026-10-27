"use client";

import { BrandTile } from "@middleware/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const navigation = [
  { href: "/", key: "home" },
  { href: "/agents", key: "agents" },
  { href: "/groups", key: "groups" },
  { href: "/chats", key: "chats" },
  { href: "/providers", key: "providers" },
  { href: "/tools", key: "tools" },
  { href: "/schedules", key: "schedules" },
  { href: "/approvals", key: "approvals" },
  { href: "/runs", key: "runs" },
  { href: "/usage", key: "usage" },
  { href: "/settings", key: "settings" },
] as const;

type Theme = "system" | "light" | "dark";

function isTheme(value: string): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function ThemeSelector() {
  const t = useTranslations("appShell.theme");
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const storedTheme = window.localStorage.getItem("theme");
      if (storedTheme === "light" || storedTheme === "dark") {
        setTheme(storedTheme);
        document.documentElement.dataset.theme = storedTheme;
      }
    } catch {
      // The visual selector still works when storage is unavailable.
    }
  }, []);

  function updateTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    if (nextTheme === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = nextTheme;
    }

    try {
      if (nextTheme === "system") {
        window.localStorage.removeItem("theme");
      } else {
        window.localStorage.setItem("theme", nextTheme);
      }
    } catch {
      // Storage is an optional persistence enhancement.
    }
  }

  return (
    <label className="flex min-h-11 items-center gap-2 rounded-field bg-raised px-3 text-small text-ink-2 shadow-raised">
      <span>{t("label")}</span>
      <select
        aria-label={t("label")}
        className="bg-transparent font-medium text-ink"
        onChange={(event) => {
          if (isTheme(event.target.value)) {
            updateTheme(event.target.value);
          }
        }}
        value={theme}
      >
        <option value="system">{t("system")}</option>
        <option value="light">{t("light")}</option>
        <option value="dark">{t("dark")}</option>
      </select>
    </label>
  );
}

export function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const t = useTranslations("appShell");
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);

  function closeNavigation() {
    setIsNavigationOpen(false);
  }

  return (
    <div className="min-h-dvh bg-bg p-4 text-ink md:p-5">
      <div className="mx-auto grid max-w-screen-2xl gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <button
          aria-controls="app-navigation"
          aria-expanded={isNavigationOpen}
          className="min-h-11 rounded-field bg-raised px-4 text-left text-body font-medium text-ink shadow-raised lg:hidden"
          onClick={() => setIsNavigationOpen(true)}
          type="button"
        >
          <span aria-hidden="true">☰</span> {t("openNavigation")} ·{" "}
          {t("brand")}
        </button>
        <aside
          className={`fixed inset-y-4 left-4 z-10 flex w-[calc(100%-2rem)] max-w-xs flex-col rounded-card bg-surface p-3 shadow-panel transition-transform lg:static lg:w-auto lg:max-w-none lg:translate-x-0 ${
            isNavigationOpen
              ? "translate-x-0"
              : "-translate-x-[calc(100%+1rem)]"
          }`}
          id="app-navigation"
        >
          <div className="flex items-center justify-between gap-3 px-2 pb-5 pt-1">
            <Link
              aria-label={t("brand")}
              className="flex items-center gap-3 text-heading font-medium text-ink"
              href="/"
              onClick={closeNavigation}
            >
              <BrandTile />
              {t("brand")}
            </Link>
            <button
              aria-label={t("closeNavigation")}
              className="grid size-11 place-items-center rounded-field bg-raised text-title text-ink shadow-raised lg:hidden"
              onClick={closeNavigation}
              type="button"
            >
              ×
            </button>
          </div>
          <nav
            aria-label={t("navigationLabel")}
            className="flex flex-col gap-1"
          >
            {navigation.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`min-h-11 rounded-field px-4 py-2 text-body ${
                    isActive
                      ? "bg-raised font-semibold text-ink shadow-raised"
                      : "text-ink-2 hover:bg-surface-2"
                  }`}
                  href={item.href}
                  key={item.href}
                  onClick={closeNavigation}
                >
                  {t(`navigation.${item.key}`)}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3 pt-6">
            <ThemeSelector />
            <div className="flex min-h-11 items-center gap-3 rounded-row bg-surface-2 px-3 text-small text-ink-2">
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-pill bg-dark-solid font-mono text-caption font-medium text-on-dark"
              >
                {t("workspaceInitials")}
              </span>
              {t("workspace")}
            </div>
          </div>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
