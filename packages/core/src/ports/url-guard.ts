/**
 * Validates a user-supplied URL before anything connects to it (S5).
 *
 * The rule lives behind a port because resolving a name is infrastructure and
 * deciding what is reachable is policy; `packages/adapters` joins the two.
 */
export interface UrlGuard {
  /**
   * Returns the parsed URL and the exact addresses it was validated against
   * when it is safe to contact, and throws `ForbiddenUrlError` otherwise.
   * Callers must use the returned value: the URL is the one that was checked,
   * and `addresses` are the only destinations the connection may use, which is
   * what closes the DNS rebinding gap (a hostile resolver can no longer answer
   * public for the check and private for the connection). For a literal host
   * the array is that literal.
   */
  assertAllowed(
    rawUrl: string,
  ): Promise<{ url: URL; addresses: readonly string[] }>;
}
