# Docker Workbench 源码

项目介绍、平台状态与许可证见 [仓库首页](../README.md)。[English](README.en.md)

本目录包含前端、Go 核心和 Tauri 桌面工程；请从包含 `code/`、`docs/` 和 `.github/` 的项目根目录发布完整仓库。

## 开发

需要 Node.js 24+、pnpm 9.14.4、Go 1.26+、Rust stable 和 [Tauri 原生依赖](https://v2.tauri.app/start/prerequisites/)。以下命令均在当前目录执行：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

```sh
pnpm desktop:build --ci --config src-tauri/tauri.ci.conf.json
```

上述本地打包不生成签名更新包；正式发行见 [发布说明](../docs/开源发布.md)。构建入口会先生成 Go sidecar；安装包输出到 `src-tauri/target/release/bundle/`。`pnpm dev` 仅提供前端预览，浏览器模式不能连接 Docker。

## 验证

```sh
pnpm build
pnpm test
pnpm core:test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

更多说明见 [贡献指南](../CONTRIBUTING.md)、[使用说明](../docs/使用说明.md) 和 [技术架构](../docs/技术方案.md)。
