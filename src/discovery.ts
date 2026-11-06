export type DiscoveryErrorCode = "missing-prerequisite" | "command-failure" | "invalid-output" | "timeout";

export class DiscoveryError extends Error {
  constructor(readonly code: DiscoveryErrorCode, readonly backend: string, message: string) {
    super(`${backend}: ${message}`);
    this.name = "DiscoveryError";
  }
}

export const COLLECTION_TIMEOUT_MS = 15_000;

// One budget covers enumeration and optional enrichment. Cache writes are staged
// until collection ends; work completing after cancellation cannot publish them.
export class CollectionContext {
  private readonly controller = new AbortController();
  private readonly expiresAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly commits: Array<() => void> = [];
  readonly warnings = new Set<string>();

  constructor(readonly backend: string, timeoutMs = COLLECTION_TIMEOUT_MS) {
    // Each parallel enrichment waits on this one collection's cancellation.
    setMaxListeners(0, this.signal);
    this.expiresAt = Date.now() + timeoutMs;
    this.timer = setTimeout(() => this.controller.abort(), timeoutMs);
  }

  get signal(): AbortSignal { return this.controller.signal; }
  get remainingMs(): number { return Math.max(1, this.expiresAt - Date.now()); }

  check(): void {
    if (this.closed || this.signal.aborted || Date.now() >= this.expiresAt) {
      throw new DiscoveryError("timeout", this.backend, "Collection deadline exceeded. Try refreshing again.");
    }
  }

  stage(commit: () => void): void {
    this.check();
    this.commits.push(commit);
  }

  warn(message: string): void {
    if (!this.closed) this.warnings.add(message);
  }

  async required<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const aborted = () => reject(new DiscoveryError("timeout", this.backend, "Collection deadline exceeded. Try refreshing again."));
      this.signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve().then(work).then(resolve, reject).finally(() => this.signal.removeEventListener("abort", aborted));
    });
  }

  async optional<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      return await this.required(work);
    } catch (error) {
      this.warn(error instanceof DiscoveryError && error.code === "timeout"
        ? "Some process details are unavailable: enrichment deadline exceeded."
        : `Some process details are unavailable: ${error instanceof Error ? error.message : "metadata query failed"}`);
      return undefined;
    }
  }

  finish(publish = true): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.controller.abort();
    if (publish) for (const commit of this.commits) commit();
  }
}

interface QueueEntry {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

// Validation requests get a new collection and take priority over queued refreshes.
export class DiscoveryCoordinator {
  private running = false;
  private readonly actions: QueueEntry[] = [];
  private readonly refreshes: QueueEntry[] = [];

  collect<T>(work: () => Promise<T>, priority: "refresh" | "action" = "refresh"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      (priority === "action" ? this.actions : this.refreshes).push({ run: work, resolve: value => resolve(value as T), reject });
      this.drain();
    });
  }

  private drain(): void {
    if (this.running) return;
    const entry = this.actions.shift() ?? this.refreshes.shift();
    if (!entry) return;
    this.running = true;
    Promise.resolve().then(entry.run).then(entry.resolve, entry.reject).finally(() => {
      this.running = false;
      this.drain();
    });
  }
}
import { setMaxListeners } from "node:events";
