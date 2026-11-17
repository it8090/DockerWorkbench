import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppError, StreamEvent } from "./types";
export const desktop = isTauri();
export const integratedTitlebar =
  desktop && navigator.platform.startsWith("Mac");
export async function setWindowTheme(dark: boolean) {
  if (desktop) await getCurrentWindow().setTheme(dark ? "dark" : "light");
}
export class RpcError extends Error {
  code: string;
  data?: Record<string, string>;
  constructor(error: AppError) {
    super(error.message);
    this.name = "RpcError";
    this.code = error.code;
    this.data = error.data;
  }
}
const handlers = new Map<string, (event: StreamEvent) => void>();
const backlog = new Map<string, StreamEvent[]>();
let initialized: Promise<unknown> | undefined;
async function init() {
  if (!desktop) return;
  if (!initialized)
    initialized = listen<StreamEvent>("core-stream", ({ payload }) => {
      const handler = handlers.get(payload.streamId);
      if (handler) {
        handler(payload);
        if (payload.kind === "end") handlers.delete(payload.streamId);
        return;
      }
      if (backlog.size > 100) backlog.delete(backlog.keys().next().value!);
      const events = backlog.get(payload.streamId) || [];
      if (events.length < 500) events.push(payload);
      backlog.set(payload.streamId, events);
    });
  await initialized;
}
export async function rpc<T = unknown>(
  method: string,
  params: unknown = {},
): Promise<T> {
  if (!desktop)
    throw new RpcError({
      code: "desktop_required",
      message: "Desktop runtime required",
    });
  await init();
  let response: { result?: T; error?: AppError };
  try {
    response = await invoke("core_request", { method, params });
  } catch (error) {
    throw new RpcError({ code: "core_unavailable", message: String(error) });
  }
  if (response.error) throw new RpcError(response.error);
  return response.result as T;
}
export async function subscribe(
  method: string,
  params: unknown,
  handler: (event: StreamEvent) => void,
): Promise<() => void> {
  await init();
  const result = await rpc<{ streamId: string }>(method, params);
  handlers.set(result.streamId, handler);
  handler({ streamId: result.streamId, kind: "ready" });
  for (const event of backlog.get(result.streamId) || []) {
    handler(event);
    if (event.kind === "end") handlers.delete(result.streamId);
  }
  backlog.delete(result.streamId);
  return () => {
    handlers.delete(result.streamId);
    backlog.delete(result.streamId);
    void rpc("stream.cancel", { streamId: result.streamId }).catch(() => {});
  };
}
export function errorValue(error: unknown): AppError {
  return error instanceof RpcError
    ? { code: error.code, message: error.message, data: error.data }
    : { code: "unexpected_error", message: String(error) };
}
export async function chooseFile() {
  return desktop ? invoke<string | null>("choose_file") : null;
}
export async function openConfig() {
  return desktop ? invoke<string | null>("open_config") : null;
}
export async function saveText(name: string, contents: string) {
  if (desktop) return invoke<boolean>("save_text", { name, contents });
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/plain;charset=utf-8" }),
  );
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
