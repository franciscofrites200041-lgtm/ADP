import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

interface FlowConnectorProps extends Omit<ComponentProps<"span">, "children"> {
  orientation?: "vertical" | "horizontal";
}

/** Dashed 2px line built with borders, so it adapts to any container width. */
export function FlowConnector({
  orientation = "vertical",
  className,
  ...props
}: FlowConnectorProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block border-dashed border-connector",
        orientation === "vertical"
          ? "mx-auto h-6 w-0 border-l-2"
          : "h-0 w-6 border-t-2",
        className,
      )}
      {...props}
    />
  );
}
