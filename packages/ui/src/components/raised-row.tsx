import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

export function RaisedRow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-row bg-raised px-4 py-3 shadow-raised text-ink",
        className,
      )}
      {...props}
    />
  );
}
