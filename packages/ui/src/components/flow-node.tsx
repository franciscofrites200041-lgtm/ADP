import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

export function FlowNode({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-row bg-raised px-4 py-3 text-body text-ink shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
