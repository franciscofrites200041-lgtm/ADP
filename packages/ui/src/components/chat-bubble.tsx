import type { ComponentProps } from "react";

import { cn } from "../cn.ts";

interface ChatBubbleProps extends ComponentProps<"div"> {
  author: "user" | "agent";
}

export function ChatBubble({ author, className, ...props }: ChatBubbleProps) {
  return (
    <div
      className={cn(
        author === "user"
          ? "ml-auto max-w-[85%] rounded-bubble bg-dark-solid px-4 py-3 text-on-dark"
          : "max-w-full text-ink",
        className,
      )}
      {...props}
    />
  );
}
