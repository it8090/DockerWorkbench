<p align="center">
  <img src="code/ui/public/mark.svg" width="72" alt="Docker Workbench 图标">
</p>

# Docker Workbench

面向开发者和运维人员的 Docker 桌面工作台。在一个窗口中管理多台主机、查看 Compose 项目、合并日志、观察资源并打开容器终端。

采用 **Tauri 2 + React / TypeScript + Go**，支持简体中文与 English、明暗主题和本地工作空间。操作布局参考 IntelliJ IDEA Services，应用直接连接 Docker Engine。

[English](README.en.md) · [使用说明](docs/使用说明.md) · [技术架构](docs/技术方案.md) · [更新记录](CHANGELOG.md) · [参与贡献](CONTRIBUTING.md)

## 功能

| 能力 | 说明 |
| --- | --- |
| 多主机与工作空间 | 按项目归类连接，切换空间、新建和重命名，配置重启后保留 |
| 多种连接方式 | SSH 密码 / OpenSSH 私钥 / Agent、Unix Socket、Windows Named Pipe、TCP + TLS；支持单级跳板与 HTTP CONNECT / SOCKS5 代理 |
| 资源浏览 | 按 Compose project / service 标签组织容器，查看镜像、网络、存储卷和 Inspect |
| 日志工作台 | 多容器日志合并、搜索、级别与时间过滤、跟随、换行、复制和导出；虚拟滚动与有界缓冲 |
| 资源与终端 | 实时 CPU / 内存 / 网络统计，基于 xterm.js 的交互终端与窗口尺寸同步 |
| 容器操作 | 启动、停止、重启；执行前预览目标，逐项显示结果并保存操作记录 |
| Compose 部署 | 关联原始 Compose 文件后执行 Pull / Up / Recreate / Down，执行前复核配置变化 |
| 配置迁移 | 预览导入 SSH config、Docker contexts 和应用 JSON；导入导出按当前工作空间处理 |
| 单实例运行 | 重复启动时恢复并聚焦已有窗口，不重复创建核心进程 |
| 软件更新 | 启动时检查或手动检查，下载进度、签名校验、安装与重启；支持关闭自动检查 |
| 桌面体验 | 中英文即时切换、明暗主题、多对象标签、全局搜索、可调整详情区；macOS 紧凑标题栏 |

## 版本与平台

当前源码版本为 **0.1.5**，处于早期阶段。安装包和校验值见 [GitHub Releases](https://github.com/it8090/DockerWorkbench/releases/latest)，各平台验证范围如下。

| 平台 | 当前验证情况 |
| --- | --- |
| macOS 13+ / Apple Silicon | 本机已构建并运行 `.app` / `.dmg`，GitHub Actions 构建已通过 |
| macOS / Intel | 已构建 DMG，原生安装运行待验证 |
| Windows / x64 | 已构建 NSIS 安装包，桌面运行及 Named Pipe 待验证 |
| Linux / x64 | 已构建 AppImage / deb，桌面运行及原生集成待验证 |

现有 macOS 构建采用本地 ad-hoc 签名，尚未完成 Developer ID 签名和公证。仓库提供三平台 CI 构建配置，实际结果以仓库 Actions 为准；软件更新通过 GitHub Releases 分发并强制验证签名。

## 安装与更新

从 [Releases](https://github.com/it8090/DockerWorkbench/releases/latest) 选择与你的系统和架构对应的安装包。macOS 使用 DMG、Windows 使用 EXE、Linux 使用 AppImage 或 deb。下载后可用随附的 `SHA256SUMS.txt` 校验。

0.1.4 起，右下角“软件更新”提供检查、下载安装和重启；正式构建默认启动后自动检查，可在更新窗口关闭。安装前会校验更新签名，失败时不安装。Windows 安装会退出应用，重启会关闭连接、日志和终端，请先结束当前操作。Linux 应用内更新适用于 AppImage，deb 通过新包升级。0.1.3 及更早版本首次升级需手动安装。

## 从源码运行

准备 Node.js **24+**、pnpm **9.14.4**、Go **1.26+**、Rust stable，以及对应系统的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。macOS 需要 Xcode Command Line Tools；Windows 需要 C++ 构建工具与 WebView2；Linux 需要 WebKitGTK 等原生依赖。

下载或克隆仓库后，在仓库根目录执行：

```sh
cd code
pnpm install --frozen-lockfile
pnpm desktop:dev
```

`desktop:dev` 会先构建 Go 核心，再启动 Tauri 桌面程序。应用首次启动没有预置连接；管理远程 Docker 时不要求本机安装 Docker Desktop。Docker Engine 应由用户自行提供；Compose 部署还需要执行端安装 Docker Compose CLI。

构建当前系统和架构的安装包：

```sh
# 在 code/ 目录执行
pnpm desktop:build
```

正式构建需要设置 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；独立开发者应使用自己的更新密钥和发行地址，详见 [发布说明](docs/开源发布.md)。只验证本地打包可运行 `pnpm desktop:build --ci --config src-tauri/tauri.ci.conf.json`，该模式不生成签名更新产物。产物位于 `code/src-tauri/target/release/bundle/`。需要其他系统的桌面包时，请在对应系统构建或使用 CI。

`pnpm dev` 仅预览 React 界面，浏览器模式无法连接 Docker。`code/index.html` 是独立的早期离线模拟原型，不代表当前桌面界面。

## 首次使用

1. 启动桌面程序，点击“添加连接”，选择 SSH、本地 Socket 或 TCP + TLS。
2. 填写连接参数并测试；SSH 首次连接须通过可信渠道核对主机指纹。
3. 保存后，在资源树选择主机、Compose 项目或容器，查看日志、Inspect 与资源统计。
4. 新连接默认只读。需要启停、部署或终端时，在连接配置中关闭“只读”，核对操作预览后执行。

更多连接示例、工作空间和 Compose 操作见 [使用说明](docs/使用说明.md)。

## 数据与权限

- 工作空间、连接元数据、布局、Compose 关联和最近 500 条操作记录保存在系统应用数据目录中的 SQLite。
- 密码和私钥口令默认仅保存在内存；选择“记住凭据”后使用系统凭据库，不写入 SQLite 或配置导出。
- SSH 严格校验主机指纹，已知指纹变化时阻断连接；TLS 校验证书及主机名。
- 日志默认不落盘；主动导出的日志和连接配置可能包含主机名、路径或业务内容，分享前请脱敏。
- 只读模式是客户端限制。Docker 与终端的实际权限由服务端账户决定；本地操作记录不提供防篡改审计。
- Compose Down 不附加 `--volumes`，会删除项目容器及相关网络。

安全问题的报告方式见 [SECURITY.md](SECURITY.md)。

## 开发与验证

在 `code/` 目录执行：

```sh
pnpm build
pnpm test
pnpm core:test
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

`core:test` 使用 Go race detector；Windows 本机如未安装所需 C 工具链，可在 `code/core/` 执行 `go test ./...`，CI 在 Windows 使用此命令。隔离测试引擎和贡献约定见 [贡献指南](CONTRIBUTING.md)。

```text
.
├── code/
│   ├── ui/          # React 工作台与中英文词条
│   ├── core/        # Docker / SSH、流、凭据与 SQLite
│   ├── src-tauri/   # Rust 桌面壳、IPC 与打包配置
│   └── scripts/     # 核心构建及文档辅助脚本
├── docs/            # 使用说明、架构与历史验证记录
└── .github/         # CI、Issue 与 Pull Request 模板
```

## 当前边界

当前不支持直接读取 PuTTY PPK、任意 ProxyCommand、多级跳板、原生 Windows 容器 shell、镜像构建推送、文件管理或团队权限。Compose 部署需要原始文件，不提供自动健康编排与回滚。历史验证覆盖与待验证项见 [实施与验收](docs/实施与验收.md)。

Docker Workbench 是独立社区项目，与 Docker, Inc. 和 JetBrains 无隶属关系。相关商标归各自所有者。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖遵循各自的许可证。
