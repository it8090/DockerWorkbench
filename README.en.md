<p align="center">
  <img src="code/ui/public/mark.svg" width="72" alt="Docker Workbench icon">
</p>

# Docker Workbench

A desktop workspace for developers and operators to manage Docker hosts, browse Compose projects, read merged logs, monitor resources, and open container terminals in one window.

Built with **Tauri 2 + React / TypeScript + Go**, with Simplified Chinese and English, light and dark themes, and local workspaces. The layout takes inspiration from IntelliJ IDEA Services; the application connects directly to Docker Engine.

[简体中文](README.md) · [User guide (中文)](docs/使用说明.md) · [Architecture (中文)](docs/技术方案.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

## Features

| Capability | Details |
| --- | --- |
| Hosts and workspaces | Organize connections by project; create, rename, and switch persistent workspaces |
| Connection methods | SSH password / OpenSSH key / agent, Unix sockets, Windows named pipes, TCP + TLS; single jump host and HTTP CONNECT / SOCKS5 proxies |
| Resource browser | Group containers by Compose project / service labels; inspect containers, images, networks, and volumes |
| Log workspace | Merged container logs, search, level and time filters, follow, wrap, copy, and export; virtual scrolling and bounded buffers |
| Resources and terminals | Live CPU / memory / network statistics; xterm.js terminals with resize support |
| Container actions | Start, stop, and restart with target previews, per-target results, and persistent history |
| Compose deployment | Pull / Up / Recreate / Down after binding original Compose files; configuration rechecked before execution |
| Configuration transfer | Preview imports from SSH config, Docker contexts, or application JSON; import and export within the current workspace |
| Single instance | Repeated launches restore and focus the existing window without creating another core process |
| Software updates | Startup or manual checks, download progress, signature verification, installation and restart; automatic checking can be disabled |
| Desktop experience | Instant language switching, themes, object tabs, global search, adjustable details, and a compact macOS title bar |

## Version and platform status

The current source version is **0.1.5**, an early version. Download installers and checksums from [GitHub Releases](https://github.com/it8090/DockerWorkbench/releases/latest). Platform verification remains as described below.

| Platform | Verification to date |
| --- | --- |
| macOS 13+ / Apple Silicon | `.app` / `.dmg` built and run in the development environment |
| macOS / Intel | Go core cross-compiled; desktop installation and runtime verification pending |
| Windows / x64 | Go core cross-compiled; desktop runtime and named pipe verification pending |
| Linux / x64 | Go core cross-compiled; desktop runtime and native integration verification pending |

Existing macOS builds use ad-hoc signing and have not been Developer ID signed or notarized. A three-platform CI workflow is included; consult the repository's Actions for actual results. Software updates are distributed through GitHub Releases and require valid signatures.

## Install and update

Choose your OS and architecture from [Releases](https://github.com/it8090/DockerWorkbench/releases/latest): DMG for macOS, EXE for Windows, and AppImage or deb for Linux. Verify downloads with the included `SHA256SUMS.txt`.

Version 0.1.4 adds **Software updates** in the status bar, with manual checks, download and installation, and restart. Release builds check at startup by default; this can be disabled in the update dialog. Signatures are verified before installation. Windows installation exits the app, and restarting closes Docker connections, logs, and terminals. Linux in-app updates apply to AppImage; upgrade deb installations with a new package. Versions 0.1.3 and earlier require a manual first upgrade.

## Run from source

Install Node.js **24+**, pnpm **9.14.4**, Go **1.26+**, Rust stable, and the [native Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). macOS requires Xcode Command Line Tools; Windows requires C++ build tools and WebView2; Linux requires WebKitGTK and other native dependencies.

After downloading or cloning the repository, run from its root:

```sh
cd code
pnpm install --frozen-lockfile
pnpm desktop:dev
```

`desktop:dev` builds the Go core before starting Tauri. The app starts with no preconfigured connections. Managing a remote Docker host does not require Docker Desktop on your computer. Provide your own Docker Engine; Compose deployments also require Docker Compose CLI on the execution host.

Build an installer for your current operating system and architecture:

```sh
# Run inside code/
pnpm desktop:build
```

Release builds require `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Independent distributors must configure their own updater key and release endpoint; see the [release guide (中文)](docs/开源发布.md). For a local packaging check without signed updater artifacts, use `pnpm desktop:build --ci --config src-tauri/tauri.ci.conf.json`. Artifacts are written to `code/src-tauri/target/release/bundle/`. Build on the corresponding operating system, or use CI, for other desktop platforms.

`pnpm dev` provides a frontend preview without Docker connectivity. `code/index.html` is an earlier, standalone offline prototype and does not represent the current desktop interface.

## First connection

1. Open the desktop app and select **Add connection**. Choose SSH, a local socket, or TCP + TLS.
2. Enter and test your connection settings. Verify an unknown SSH host fingerprint through a trusted channel.
3. Save, then select a host, Compose project, or container to view logs, Inspect, and statistics.
4. New connections default to read-only. Disable **Read-only** in connection settings when you need lifecycle actions, deployments, or terminals, then review the action preview before execution.

The [user guide (中文)](docs/使用说明.md) covers connection examples, workspaces, and Compose operations.

## Data and permissions

- Workspaces, connection metadata, layout, Compose bindings, and the latest 500 operation records are stored in SQLite in the system application data directory.
- Passwords and key passphrases remain in memory unless you choose the OS credential store. They are excluded from SQLite and configuration exports.
- SSH host fingerprints are checked strictly; changed known keys block the connection. TLS verifies certificates and hostnames.
- Logs are not saved to disk by default. Exported logs and configurations can contain hostnames, paths, or business data; redact them before sharing.
- Read-only mode is a client-side restriction. Server accounts determine actual Docker and terminal permissions. Local history is not a tamper-proof audit log.
- Compose Down removes project containers and related networks without adding `--volumes`.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Development and checks

Run inside `code/`:

```sh
pnpm build
pnpm test
pnpm core:test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

`core:test` uses the Go race detector. On Windows without the required C toolchain, run `go test ./...` inside `code/core/`; Windows CI uses this command. See [CONTRIBUTING.md](CONTRIBUTING.md) for the isolated test engine and contribution guidelines.

```text
.
├── code/
│   ├── ui/          # React workspace and translations
│   ├── core/        # Docker / SSH, streams, credentials, SQLite
│   ├── src-tauri/   # Rust shell, IPC, packaging
│   └── scripts/     # Core builds and documentation helpers
├── docs/            # Usage, architecture, historical verification
└── .github/         # CI, issue templates, pull request template
```

## Current limits

No direct PuTTY PPK support, arbitrary ProxyCommand, multi-hop jump chains, native Windows container shells, image builds or pushes, file manager, or team authorization. Compose deployments require original source files and do not provide automatic health orchestration or rollback. See [historical verification (中文)](docs/实施与验收.md) for coverage and pending checks.

Docker Workbench is an independent community project, unaffiliated with Docker, Inc. or JetBrains. Trademarks belong to their respective owners.

## License

Licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
