import { describe, expect, it, vi } from "vitest";
import { UpdateController, type DownloadEvent } from "./updater";

const release = { version: "0.1.5", body: "New release" };
function fixture() {
  const api = {
    check: vi.fn().mockResolvedValue(release),
    install: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
  };
  return { api, controller: new UpdateController(vi.fn(), api) };
}
describe("desktop update lifecycle", () => {
  it("coalesces simultaneous startup and manual checks", async () => {
    const { api, controller } = fixture();
    let resolve!: (value: typeof release) => void;
    api.check.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = controller.check();
    await controller.check();
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(controller.state.phase).toBe("checking");
    resolve(release);
    await first;
    expect(controller.state.update).toEqual(release);
    expect(controller.state.phase).toBe("available");
  });
  it("does not install without an available release and prevents concurrent installs", async () => {
    const { api, controller } = fixture();
    await controller.install();
    expect(api.install).not.toHaveBeenCalled();
    await controller.check();
    let finish!: () => void;
    api.install.mockImplementation(
      (onEvent: (event: DownloadEvent) => void) =>
        new Promise<void>((done) => {
          finish = done;
          onEvent({ event: "Started", data: { contentLength: 100 } });
          onEvent({ event: "Progress", data: { chunkLength: 30 } });
          onEvent({ event: "Progress", data: { chunkLength: 70 } });
          onEvent({ event: "Finished" });
        }),
    );
    const installing = controller.install();
    await controller.install();
    await controller.check();
    expect(api.install).toHaveBeenCalledTimes(1);
    expect(api.check).toHaveBeenCalledTimes(1);
    expect(controller.state).toMatchObject({
      phase: "installing",
      total: 100,
      received: 100,
    });
    finish();
    await installing;
    expect(controller.state.phase).toBe("installed");
    expect(api.restart).not.toHaveBeenCalled();
  });
  it("requires a fresh check after a failed or rejected signature installation", async () => {
    const { api, controller } = fixture();
    await controller.check();
    api.install.mockRejectedValueOnce(
      new Error("signature verification failed"),
    );
    await controller.install();
    expect(controller.state).toMatchObject({
      phase: "error",
      update: undefined,
    });
    await controller.install();
    await controller.restart();
    expect(api.install).toHaveBeenCalledTimes(1);
    expect(api.restart).not.toHaveBeenCalled();
    await controller.check();
    await controller.install();
    expect(controller.state.phase).toBe("installed");
  });
  it("retains the installed update when relaunch fails and permits retry", async () => {
    const { api, controller } = fixture();
    await controller.check();
    await controller.install();
    api.restart.mockRejectedValueOnce(new Error("restart unavailable"));
    await controller.restart();
    expect(controller.state.phase).toBe("installed");
    expect(controller.state.error).toContain("restart unavailable");
    await controller.restart();
    expect(api.restart).toHaveBeenCalledTimes(2);
  });
  it("recovers from an offline check and distinguishes no update", async () => {
    const { api, controller } = fixture();
    api.check.mockRejectedValueOnce(new Error("offline"));
    await controller.check();
    expect(controller.state.phase).toBe("error");
    api.check.mockResolvedValueOnce(null);
    await controller.check();
    expect(controller.state.phase).toBe("current");
    expect(controller.state.error).toBeUndefined();
  });
});
