/**
 * Registry of promises the process must wait for on shutdown (§5): the run
 * started by a request lives here, so it survives the client disconnecting.
 */
export type BackgroundTasks = {
  /**
   * Starts `task` and registers it. The returned promise settles with the
   * task: a caller may await it, but nobody has to; the registry observes
   * rejections so fire-and-forget tasks never become unhandled rejections.
   */
  track(task: () => Promise<void>): Promise<void>;
  /**
   * Waits for every tracked task and reports whether all of them finished
   * before the timeout. `false` means "still running", never a hang.
   */
  drain(timeoutMs: number): Promise<boolean>;
};
