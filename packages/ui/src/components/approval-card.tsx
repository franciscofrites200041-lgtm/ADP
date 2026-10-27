import type { ComponentProps } from "react";

import { DarkPanel } from "./dark-panel.tsx";

export function ApprovalCard(props: ComponentProps<"section">) {
  return <DarkPanel {...props} />;
}
