import type { ListenerTarget, PortProcess, PortSnapshot } from "./types.js";

export interface Selection {
  target?: ListenerTarget;
  index: number;
}

export function selectedIndex(rows: readonly PortProcess[], selection: Selection): number {
  if (!rows.length) return -1;
  const found = rows.findIndex(row => row.pid === selection.target?.pid && row.port === selection.target?.port);
  return found >= 0 ? found : Math.max(0, Math.min(selection.index, rows.length - 1));
}

// Coalesce timer/manual/post-action refreshes, keeping action feedback separate.
export class RefreshController {
  private running = false;
  private queued = false;
  private active = true;

  constructor(
    private readonly collect: () => Promise<PortSnapshot>,
    private readonly onStart: () => void,
    private readonly onSuccess: (snapshot: PortSnapshot) => void,
    private readonly onError: (error: unknown) => void,
    private readonly onEnd: () => void
  ) {}

  request(): void {
    if (!this.active) return;
    if (this.running) { this.queued = true; return; }
    this.running = true;
    this.onStart();
    void this.collect().then(snapshot => {
      if (this.active) this.onSuccess(snapshot);
    }, error => {
      if (this.active) this.onError(error);
    }).finally(() => {
      this.running = false;
      if (!this.active) return;
      this.onEnd();
      if (this.queued) { this.queued = false; this.request(); }
    });
  }

  dispose(): void { this.active = false; this.queued = false; }
}
