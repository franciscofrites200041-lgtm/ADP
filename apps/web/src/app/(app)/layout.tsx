import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "./_components/app-shell";
import { currentSession } from "./session";

/**
 * Guards every page under `(app)`: without a session the API says 401 and the
 * browser goes to /login (§11: the session lives in the API, not in Next).
 */
export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const session = await currentSession();
  if (!session) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
