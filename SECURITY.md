# 安全报告 / Security policy

## 范围

项目处于早期开发阶段，安全修复优先面向最新源码及最新 0.1.x 版本，不承诺维护旧版本分支或固定响应时限。使用前请查看 [README](README.md) 中的平台验证状态与权限说明。

SSH 主机验证、TLS 校验、凭据处理、IPC 边界、只读限制绕过和非预期命令执行等问题适合通过安全渠道报告。普通功能缺陷请使用 Issue。

## 私下报告

请先查看本仓库 **Security → Advisories → Report a vulnerability**。该入口仅在维护者启用 GitHub Private vulnerability reporting 后可用；本文件本身不会启用此功能。

如果该入口不可用，请提交不包含漏洞细节的 Issue，仅请求维护者提供私下沟通渠道。在取得私下渠道前，请勿公开复现利用、密钥、令牌或真实连接信息。

报告建议包含受影响版本、系统与连接类型、最小复现、预期与实际行为、影响范围，以及使用模拟环境生成的脱敏证据。请仅在自己有权测试的环境中复现。

[GitHub 私密漏洞报告设置说明](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)

## English

This is an early-stage project. Security fixes focus on the latest source and latest 0.1.x version, without a guaranteed response time or maintenance of older branches.

Report issues involving host verification, TLS, credentials, IPC boundaries, read-only bypasses, or unintended command execution privately. Use **Security → Advisories → Report a vulnerability** if the repository has private reporting enabled. This document does not enable that feature.

If the private reporting entry is unavailable, open an issue requesting a private contact channel without disclosing vulnerability details. Do not post exploits, credentials, tokens, or real connection data publicly. Include affected versions, environment, a minimal reproduction, impact, and redacted evidence from an authorized test environment in your private report.
