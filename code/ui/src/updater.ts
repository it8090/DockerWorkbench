import { Channel, invoke } from "@tauri-apps/api/core";

export type UpdateInfo = { version: string; body: string | null };
export type DownloadEvent =
  | { event: "Started"; data: { contentLength: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "downloading"
  | "installing"
  | "installed"
  | "error";
export type UpdateState = {
  phase: UpdatePhase;
  update?: UpdateInfo;
  received: number;
  total?: number;
  error?: string;
};
type UpdateApi = {
  check: () => Promise<UpdateInfo | null>;
  install: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
  restart: () => Promise<void>;
};
const nativeApi: UpdateApi = {
  check: () => invoke("check_update"),
  install: (onEvent) => {
    const channel = new Channel<DownloadEvent>();
    channel.onmessage = onEvent;
    return invoke("install_update", { onEvent: channel });
  },
  restart: () => invoke("restart_app"),
};

// One controller serializes background checks, manual checks, and installation.
export class UpdateController {
  state: UpdateState = { phase: "idle", received: 0 };
  private busy = false;
  constructor(
    private onChange: (state: UpdateState) => void,
    private api: UpdateApi = nativeApi,
  ) {}
  private set(next: Partial<UpdateState>) {
    this.state = { ...this.state, ...next };
    this.onChange(this.state);
  }
  async check() {
    if (this.busy || this.state.phase === "installed") return;
    this.busy = true;
    this.set({ phase: "checking", error: undefined, update: undefined });
    try {
      const update = await this.api.check();
      this.set({
        phase: update ? "available" : "current",
        update: update || undefined,
      });
    } catch (error) {
      this.set({ phase: "error", error: String(error) });
    } finally {
      this.busy = false;
    }
  }
  async install() {
    if (this.busy || this.state.phase !== "available") return;
    this.busy = true;
    this.set({
      phase: "downloading",
      received: 0,
      total: undefined,
      error: undefined,
    });
    try {
      await this.api.install((event) => {
        if (event.event === "Started")
          this.set({ total: event.data.contentLength || undefined });
        if (event.event === "Progress")
          this.set({ received: this.state.received + event.data.chunkLength });
        if (event.event === "Finished") this.set({ phase: "installing" });
      });
      this.set({ phase: "installed" });
    } catch (error) {
      // Native installation consumes the pending update, even on failure.
      this.set({ phase: "error", update: undefined, error: String(error) });
    } finally {
      this.busy = false;
    }
  }
  async restart() {
    if (this.busy || this.state.phase !== "installed") return;
    this.busy = true;
    try {
      await this.api.restart();
    } catch (error) {
      // Preserve the installed state so a failed relaunch can be retried.
      this.set({ error: String(error) });
    } finally {
      this.busy = false;
    }
  }
}
