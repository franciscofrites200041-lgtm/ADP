"use client";

import type {
  ConversationListResponse,
  ConversationResponse,
} from "@middleware/contracts";
import { Card } from "@middleware/ui";
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";

/** The day and hour the conversation was last touched (§7: `updated_at`). */
const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

type ConversationListProps = {
  /** The workspace's conversations, newest first (S11). */
  conversations: UseInfiniteQueryResult<
    InfiniteData<ConversationListResponse>,
    Error
  >;
  selectedId: string | null;
  onSelect: (conversation: ConversationResponse) => void;
};

/**
 * The history column of the chat (T10): the workspace's past conversations
 * with their titles and last update, and the one open right now marked.
 * What opening a conversation does stays in the screen; this component only
 * speaks for the list.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: ConversationListProps) {
  const t = useTranslations("chat");
  const items = (conversations.data?.pages ?? []).flatMap(
    (page) => page.conversations,
  );

  return (
    <Card className="p-3">
      <h2 className="px-1 pb-2 text-small font-medium text-ink-2">
        {t("conversationsTitle")}
      </h2>
      {conversations.isError ? (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-small text-ink">{t("conversationsError")}</p>
          <button
            className="min-h-11 rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
            onClick={() => void conversations.refetch()}
            type="button"
          >
            {t("retry")}
          </button>
        </div>
      ) : (
        <ul aria-label={t("conversationsLabel")} className="space-y-1">
          {items.map((conversation) => (
            <li key={conversation.id}>
              <button
                aria-current={conversation.id === selectedId}
                className="min-h-11 w-full rounded-field px-3 py-2 text-left text-body text-ink hover:bg-raised aria-current:bg-raised"
                onClick={() => onSelect(conversation)}
                type="button"
              >
                <span className="block truncate">
                  {conversation.title ?? t("untitled")}
                </span>
                <span className="block text-small text-ink-2">
                  {formatDate(conversation.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!conversations.isError && items.length === 0 ? (
        <p className="px-1 py-2 text-small text-muted">
          {t("emptyConversations")}
        </p>
      ) : null}
      {conversations.hasNextPage ? (
        <button
          className="min-h-11 w-full rounded-field bg-raised px-4 text-small font-medium text-ink shadow-raised"
          onClick={() => void conversations.fetchNextPage()}
          type="button"
        >
          {t("loadMore")}
        </button>
      ) : null}
    </Card>
  );
}
