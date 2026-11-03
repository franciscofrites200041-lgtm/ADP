import type { ProviderId } from "@middleware/contracts";
import { providerCatalog } from "@middleware/contracts";

/** `····9f3k`: the only part of a key the UI may ever show (S2). */
export function maskLast4(last4: string): string {
  return `····${last4}`;
}

/** The base URL field only exists for providers that need one. */
export function needsBaseUrl(providerId: ProviderId): boolean {
  return (
    providerCatalog.find((provider) => provider.id === providerId)
      ?.needsBaseUrl === true
  );
}

export function providerLabel(providerId: ProviderId): string {
  return (
    providerCatalog.find((provider) => provider.id === providerId)?.label ??
    providerId
  );
}

/** First letter of the provider label, for the monogram tile. */
export function providerMonogram(providerId: ProviderId): string {
  return providerLabel(providerId).slice(0, 1).toUpperCase();
}
