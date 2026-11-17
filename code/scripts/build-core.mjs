import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const os =
  process.env.BUILD_GOOS ||
  { darwin: "darwin", win32: "windows", linux: "linux" }[process.platform];
const arch =
  process.env.BUILD_GOARCH || (process.arch === "arm64" ? "arm64" : "amd64");
const target =
  process.env.BUILD_TARGET ||
  `${arch === "arm64" ? "aarch64" : "x86_64"}-${{ darwin: "apple-darwin", windows: "pc-windows-msvc", linux: "unknown-linux-gnu" }[os]}`;
mkdirSync(`${root}/src-tauri/binaries`, { recursive: true });
const binary = `${root}/src-tauri/binaries/docker-workbench-core-${target}${os === "windows" ? ".exe" : ""}`;
const r = spawnSync(
  "go",
  [
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    binary,
    "./cmd/workbench-core",
  ],
  {
    cwd: `${root}/core`,
    env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: "0" },
    stdio: "inherit",
  },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`Built ${binary}`);
