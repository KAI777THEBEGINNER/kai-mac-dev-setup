# Zellij 中文背景缺口修复

本机 Zellij 0.45.1 在清除含中文的行尾时，按字符数而非显示格数填充背景，导致 Codex 问答框、输入框右侧出现缺口。与 Ghostty shader 无关。

上游修复 [PR #5657](https://github.com/zellij-org/zellij/pull/5657) 于 2026-09-28 合并，晚于 0.45.1 发布。本目录的补丁只保留该 PR 的 grid 实现、回归测试和快照改动，可以直接应用于官方 v0.45.1 源码。

验证使用 68 格宽的隔离终端，先输出 20 个中文字符，再回车写 ASCII 并发送 CSI K 清除行尾。原版只保留 51 格，少了 17 格背景。

本次曾尝试 background-opacity-cells，未解决，已撤回；Ghostty 个性化设置保持原样。

## 本机安装与验证

- 程序：`~/.local/lib/zellij/0.45.1-cjk5657/zellij`。
- 启动入口：`~/.local/bin/zellij` 链接到上述程序；现有 `.zshrc` 的 PATH 会优先使用它。Homebrew 原版 `/opt/homebrew/bin/zellij` 保留。
- 既有 Zellij 服务继续使用原来的进程；结束当前工作并重启 Ghostty 后，新服务使用修复版。
- 同一隔离 PTY 测试：原版背景覆盖 `51/68` 格，修复版覆盖 `68/68` 格，最后一格仍为 `RGB(30,30,30)`。
- 原版与修复版使用相同的 0.45.1 IPC 协议，版本号保留为 `zellij 0.45.1`。
- 官方版本升级且包含 PR #5657 后，移除 `~/.local/bin/zellij` 链接即可恢复使用 Homebrew 程序。

构建基于官方 v0.45.1 源码，应用本目录补丁；Rust 1.99.1，命令如下。关闭 LTO 并使用 16 个 codegen unit 以减少本机编译等待，功能保持一致，WASM 插件使用发行包自带资源。

```sh
CARGO_BUILD_JOBS=2 CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 cargo +stable build --release --locked --no-default-features --features vendored_curl,web_server_capability
```

安装程序 SHA-256：`61ab285f4b95cf344a5a0b46097834e423d6860fa51d7fe2656a212af6f8c93c`。
