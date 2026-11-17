# Docker Workbench source

See the [repository homepage](../README.en.md) for features, platform status, and licensing. [简体中文](README.md)

This directory contains the frontend, Go core, and Tauri project. Publish the complete repository from the parent directory containing `code/`, `docs/`, and `.github/`.

## Development

Requires Node.js 24+, pnpm 9.14.4, Go 1.26+, Rust stable, and the [native Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Run all commands below in this directory:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

```sh
pnpm desktop:build --ci --config src-tauri/tauri.ci.conf.json
```

This local packaging command omits signed updater artifacts; see the [release guide (中文)](../docs/开源发布.md) for distribution. Both desktop commands build the Go sidecar first. Installers are written to `src-tauri/target/release/bundle/`. `pnpm dev` only previews the frontend and cannot connect to Docker.

## Checks

```sh
pnpm build
pnpm test
pnpm core:test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

See [CONTRIBUTING.md](../CONTRIBUTING.md), the [user guide (中文)](../docs/使用说明.md), and [architecture (中文)](../docs/技术方案.md) for details.
