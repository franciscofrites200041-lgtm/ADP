"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

function isTheme(value: string): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeSelector() {
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
