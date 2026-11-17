# 参与贡献 / Contributing

欢迎提交缺陷、文档修正、翻译和功能改进。日常沟通可以使用中文或 English。开始开发前请阅读 [README](README.md)、[架构](docs/技术方案.md) 和 [安全报告说明](SECURITY.md)。

## 提交 Issue

缺陷报告请包含应用版本、系统和架构、连接类型、复现步骤、预期与实际行为。连接问题可以补充 Docker Engine / API 版本；不需要分享真实主机、密钥、口令或业务配置。日志、Inspect 和截图请先脱敏。

较大的功能或架构变更，请先通过 Issue 讨论使用场景和范围。安全漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。

## 本地环境

需要 Node.js 24+、pnpm 9.14.4、Go 1.26+、Rust stable 和 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。从仓库根目录进入源码目录：

```sh
cd code
pnpm install --frozen-lockfile
pnpm desktop:dev
```

界面词条位于 `code/ui/src/i18n.ts`；新增文案请同时提供中英文，并保持占位符一致。生产界面不应混入离线原型的模拟连接。

## 相关检查

在 `code/` 中按改动范围运行：

```sh
pnpm build
pnpm test
pnpm core:test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

`core:test` 运行 `go test -race ./...`，需要平台支持及 C 工具链。Windows CI 在 `code/core/` 中运行 `go test ./...`。涉及 Rust 或打包时，补充 `pnpm desktop:build --ci --config src-tauri/tauri.ci.conf.json`；纯文档修改检查链接、命令和示例即可。

请遵循现有代码格式。`pnpm format:check` 检查前端与构建脚本格式；Go 修改使用 `gofmt`，Rust 修改使用 `cargo fmt`。

## 隔离测试引擎

macOS / Linux 可在一个独立终端中启动进程内 Docker API 测试引擎：

```sh
cd code/core
go run ./cmd/test-engine --socket /tmp/workbench-acceptance.sock
```

在桌面应用中添加 `unix:///tmp/workbench-acceptance.sock` 连接。测试引擎不创建真实容器，不执行真实 shell 命令，不随安装包发行。退出时按 Ctrl+C。Windows 原生 socket 验收需单独适配。

## Pull Request

- 每个 PR 聚焦一项问题，说明触发条件、行为变化和验证结果。
- 保留默认只读、SSH 指纹校验、TLS 校验与写操作预览等约束；涉及这些约束时补充相应验证。
- 不提交连接导出、应用数据库、私钥、原始业务截图、依赖缓存或安装包。发布包通过 GitHub Releases 分发。
- 新增依赖时说明用途，并确认许可证适合项目；保留锁文件更新。
- 提交的原创贡献按项目 [MIT 许可证](LICENSE) 提供；引用第三方内容时保留相应声明。

## English

Issues and pull requests are welcome in Chinese or English. Include the app version, OS / architecture, transport, reproduction steps, and expected versus actual behavior. Redact logs, Inspect output, screenshots, and configuration before sharing. Discuss substantial changes in an issue first; report vulnerabilities using [SECURITY.md](SECURITY.md).

Development requires Node.js 24+, pnpm 9.14.4, Go 1.26+, Rust stable, and the native Tauri prerequisites. Run the commands above from `code/`. The acceptance engine command runs from `code/core/` on macOS / Linux and does not create containers or execute shell commands.

Keep PRs focused, describe the behavior change and relevant validation, and update both UI languages. Preserve connection verification, read-only enforcement, and action previews. Do not commit secrets, connection exports, databases, private screenshots, build artifacts, or installers. Original contributions are provided under the project's MIT license; retain notices for third-party material.
