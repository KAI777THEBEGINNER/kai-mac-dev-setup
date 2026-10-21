#!/usr/bin/env python3
"""配置同步器：本机 ⇄ 仓库。

    python3 tools/sync.py status             # 看看哪些配置和仓库不一致
    python3 tools/sync.py export             # 本机 → 仓库（改完配置跑这个，然后 git commit）
    python3 tools/sync.py apply              # 仓库 → 本机（新电脑跑这个）

选项：
    --home DIR        操作另一个 HOME（冒烟测试用），默认 $HOME
    --groups a,b      只处理这些分组，默认 terminal；apply 时 claude-code 组仅在
                      本机存在 ~/.claude 时生效
    --only id1,id2    只处理指定 entry（调试用）
    --dry-run         只打印计划，不动文件
    --no-packages     apply 时不检查/安装 pi 扩展包
    --force           export 时忽略密钥扫描告警
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "manifest.json"
DEFAULT_GROUPS = ["terminal"]

# 这些后缀一律当二进制处理，不做 {{HOME}} 替换
BINARY_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns",
    ".ttf", ".otf", ".woff", ".woff2", ".zip", ".gz", ".tgz", ".wasm",
    ".pdf", ".mp3", ".mp4", ".mov", ".dylib", ".so", ".o", ".a",
}

# 明显是凭证的字符串：export 时发现就停下来
SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]

C_OK, C_WARN, C_ERR, C_DIM, C_END = "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m"

BACKUP_ROOT: Path = Path.home() / ".mac-dev-setup-backup"
backupped: list[Path] = []


# --------------------------------------------------------------------------- 基础

def info(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(f"{C_WARN}⚠ {msg}{C_END}", flush=True)


def fail(msg: str) -> None:
    print(f"{C_ERR}✗ {msg}{C_END}", flush=True)


def load_manifest() -> dict:
    with MANIFEST_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def expand(target: str, home: Path) -> Path:
    if target.startswith("~/"):
        return home / target[2:]
    if target == "~":
        return home
    return Path(target)


def pretty(path: Path, home: Path) -> str:
    try:
        return "~/" + str(path.relative_to(home))
    except ValueError:
        return str(path)


def is_binary(path: Path) -> bool:
    if path.suffix.lower() in BINARY_SUFFIXES:
        return True
    try:
        chunk = path.read_bytes()[:8192]
    except OSError:
        return True
    return b"\x00" in chunk


def render(data: bytes, home: Path, direction: str, token: str) -> bytes:
    if b"\x00" in data[:8192]:
        return data
    text = data.decode("utf-8", errors="surrogateescape")
    if direction == "export":
        text = text.replace(str(home), token)
    else:
        text = text.replace(token, str(home))
    return text.encode("utf-8", errors="surrogateescape")


def backup_path(path: Path, home: Path) -> Path:
    try:
        rel = path.relative_to(home)
    except ValueError:
        rel = Path(str(path).lstrip("/"))
    return BACKUP_ROOT / rel


def write_file(dest: Path, data: bytes, mode_from: Path | None, dry: bool) -> None:
    if dry:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".sync-tmp")
    tmp.write_bytes(data)
    if mode_from is not None:
        try:
            os.chmod(tmp, mode_from.stat().st_mode & 0o777)
        except OSError:
            pass
    os.replace(tmp, dest)


def snapshot(dest: Path, home: Path, dry: bool) -> None:
    """apply 覆盖前留一份原文件，方便回滚。"""
    if dry or not dest.exists() or dest.is_dir():
        return
    target = backup_path(dest, home)
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, target)
    backupped.append(dest)


# --------------------------------------------------------------------------- 文件选择

def walk_selected(root: Path, entry: dict) -> list[Path]:
    include = entry.get("include") or ["*"]
    exclude = entry.get("exclude") or []
    skip_dirs = {".git", "node_modules", "__pycache__", ".DS_Store", "assets"} & set(exclude)

    picked: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in skip_dirs)
        for name in sorted(filenames):
            if name == ".DS_Store":
                continue
            if any(fnmatch.fnmatch(name, pat) for pat in exclude):
                continue
            if not any(fnmatch.fnmatch(name, pat) for pat in include):
                continue
            picked.append(Path(dirpath) / name)
    return picked


def apply_chmod(path: Path, patterns: list[str], dry: bool) -> None:
    if dry or not patterns:
        return
    if any(fnmatch.fnmatch(path.name, pat) for pat in patterns):
        try:
            os.chmod(path, path.stat().st_mode | 0o111)
        except OSError:
            pass


# --------------------------------------------------------------------------- export

def export_entry(entry: dict, home: Path, token: str, dry: bool) -> str:
    src = expand(entry["target"], home)
    repo = ROOT / entry["repo"]
    if not src.exists():
        return f"{C_DIM}skip{C_END} {entry['id']}：本机没有 {pretty(src, home)}"

    if entry["kind"] == "file":
        if src.is_dir():
            return f"{C_WARN}warn{C_END} {entry['id']}：{pretty(src, home)} 是目录"
        data = render(src.read_bytes(), home, "export", token)
        if repo.exists() and repo.read_bytes() == data:
            return f"  = {entry['id']}"
        write_file(repo, data, src, dry)
        return f"{C_OK}↑ {C_END} {entry['id']}  {pretty(src, home)} → {entry['repo']}"

    picked = walk_selected(src, entry)
    rendered = {
        path.relative_to(src): render(path.read_bytes(), home, "export", token)
        for path in picked
    }
    existing = set()
    if repo.exists():
        for sub in repo.rglob("*"):
            if sub.is_file() and ".git" not in sub.parts:
                existing.add(sub.relative_to(repo))
    unchanged = set(rendered) == existing and all(
        (repo / rel).read_bytes() == data for rel, data in rendered.items()
    )
    if unchanged:
        return f"  = {entry['id']}（{len(rendered)} 个文件）"
    if not dry:
        if repo.exists():
            shutil.rmtree(repo)
        repo.mkdir(parents=True, exist_ok=True)
    for rel, data in rendered.items():
        write_file(repo / rel, data, src / rel, dry)
    return (
        f"{C_OK}↑ {C_END} {entry['id']}  {len(rendered)} 个文件"
        f"（{len(existing - set(rendered))} 个删除）  {pretty(src, home)} → {entry['repo']}"
    )


# --------------------------------------------------------------------------- apply

def apply_entry(entry: dict, home: Path, token: str, dry: bool) -> str:
    repo = ROOT / entry["repo"]
    dest = expand(entry["target"], home)

    if entry["kind"] == "file":
        if not repo.exists():
            return f"{C_WARN}warn{C_END} {entry['id']}：仓库缺 {entry['repo']}，先跑 export"
        base = dest
        if base.exists() and base.is_dir():
            return f"{C_ERR}err{C_END} {entry['id']}：目标 {pretty(base, home)} 是目录"
        data = render(repo.read_bytes(), home, "apply", token)
        if base.exists() and base.read_bytes() == data:
            return f"  = {entry['id']}"
        snapshot(base, home, dry)
        write_file(base, data, repo, dry)
        return f"{C_OK}↓ {C_END} {entry['id']}  {entry['repo']} → {pretty(base, home)}"

    if not repo.exists():
        return f"{C_WARN}warn{C_END} {entry['id']}：仓库缺 {entry['repo']}，先跑 export"
    picked = walk_selected(repo, entry)
    count = 0
    for path in picked:
        rel = path.relative_to(repo)
        target = dest / rel
        data = render(path.read_bytes(), home, "apply", token)
        if not (target.exists() and target.read_bytes() == data):
            snapshot(target, home, dry)
            write_file(target, data, path, dry)
            count += 1
        apply_chmod(target, entry.get("chmodExec") or [], dry)
    suffix = f"，更新 {count} 个" if count else "，无变化"
    return f"{C_OK}↓ {C_END} {entry['id']}  {len(picked)} 个文件 → {pretty(dest, home)}{suffix}"


# --------------------------------------------------------------------------- status

def status_entry(entry: dict, home: Path, token: str) -> str:
    repo = ROOT / entry["repo"]
    live = expand(entry["target"], home)
    if not repo.exists():
        return f"{C_WARN}缺仓库{C_END} {entry['id']}：跑 export"
    if not live.exists():
        return f"{C_WARN}未安装{C_END} {entry['id']}：{pretty(live, home)}"

    if entry["kind"] == "file":
        if render(repo.read_bytes(), home, "apply", token) == live.read_bytes():
            return f"  = {entry['id']}"
        return f"{C_WARN}有差异{C_END} {entry['id']}：{pretty(live, home)}"

    repo_files = {p.relative_to(repo) for p in walk_selected(repo, entry)}
    live_files = {p.relative_to(live) for p in walk_selected(live, entry)}
    changed = 0
    for rel in sorted(repo_files & live_files):
        if render((repo / rel).read_bytes(), home, "apply", token) != (live / rel).read_bytes():
            changed += 1
    repo_only = len(repo_files - live_files)
    live_only = len(live_files - repo_files)
    if not changed and not repo_only and not live_only:
        return f"  = {entry['id']}"
    bits = []
    if changed:
        bits.append(f"{changed} 个内容不同")
    if repo_only:
        bits.append(f"仓库多 {repo_only} 个")
    if live_only:
        bits.append(f"本机多 {live_only} 个")
    return f"{C_WARN}有差异{C_END} {entry['id']}：" + "，".join(bits)


# --------------------------------------------------------------------------- hooks

def hook_pi_packages(home: Path, dry: bool) -> None:
    settings_path = home / ".pi" / "agent" / "settings.json"
    if not settings_path.exists():
        return
    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        warn("pi settings.json 解析失败，跳过扩展包检查")
        return
    packages = [p for p in settings.get("packages", []) if isinstance(p, str)]
    npm_dir = home / ".pi" / "agent" / "npm" / "node_modules"
    missing = []
    for spec in packages:
        if not spec.startswith("npm:"):
            continue
        name = spec[4:].split("@")[0] if not spec[4:].startswith("@") else "@" + spec[4:].lstrip("@").split("/")[0] + "/" + spec[4:].split("/")[-1].split("@")[0]
        if not (npm_dir / name).exists():
            missing.append(spec)
    if not missing:
        info(f"  = pi 扩展包齐全（{len(packages)} 个）")
        return
    pi_bin = shutil.which("pi")
    if not pi_bin:
        warn("pi 不在 PATH，先装 pi 再跑：pi update --extensions")
        return
    if dry:
        info(f"  · 将安装缺失的 pi 扩展包：{', '.join(missing)}")
        return
    info(f"  · 安装缺失的 pi 扩展包：{', '.join(missing)}")
    env = dict(os.environ, HOME=str(home))
    try:
        proc = subprocess.run(
            [pi_bin, "update", "--extensions"],
            env=env, capture_output=True, text=True, timeout=900,
        )
    except subprocess.TimeoutExpired:
        warn("pi update --extensions 超时，稍后手动重跑")
        return
    tail = (proc.stdout + proc.stderr).strip().splitlines()[-6:]
    for line in tail:
        info(f"    {line}")
    if proc.returncode != 0:
        warn(f"pi update --extensions 退出码 {proc.returncode}，首次启动 pi 时它会再试")


def hook_pii_guard(home: Path, dry: bool) -> None:
    settings_path = home / ".pi" / "agent" / "settings.json"
    project = home / "workspace" / "pi-pii-guard" / "src" / "index.ts"
    if not settings_path.exists():
        return
    settings = json.loads(settings_path.read_text(encoding="utf-8"))
    ext = settings.setdefault("extensions", [])
    if not project.exists():
        if str(project) in ext:
            ext.remove(str(project))
            if not dry:
                settings_path.write_text(
                    json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
            info("  · 本机没有 pi-pii-guard 项目，已从 extensions 摘掉（可选组件）")
        else:
            info("  · 本机没有 pi-pii-guard 项目，pii-guard 不启用（可选）")
        return
    if str(project) in ext:
        info("  = pii-guard 扩展已登记")
        return
    if dry:
        info("  · 将把 pii-guard 扩展补进 settings.json")
        return
    ext.append(str(project))
    settings_path.write_text(
        json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    info(f"  ↓ 已把 pii-guard 扩展补进 settings.json（词表在 ~/.pi/agent/pii-guard/，需单独准备）")


def hook_launchagent(home: Path, dry: bool) -> None:
    plist = home / "Library" / "LaunchAgents" / "com.local.claude-config-sanitizer.plist"
    if not plist.exists() or shutil.which("launchctl") is None:
        return
    if dry:
        info("  · 将加载 Claude 配置消毒 LaunchAgent")
        return
    uid = os.getuid()
    subprocess.run(
        ["launchctl", "bootstrap", f"gui/{uid}", str(plist)],
        capture_output=True, text=True,
    )
    info("  ↓ 已尝试加载 Claude 配置消毒 LaunchAgent（已加载会静默忽略）")


PREREQS = [
    ("brew", "Homebrew", "https://brew.sh"),
    ("ghostty", "Ghostty", "brew install --cask ghostty"),
    ("zellij", "zellij", "brew install zellij"),
    ("pi", "pi coding agent", "npm install -g --ignore-scripts @earendil-works/pi-coding-agent"),
    ("node", "Node.js", "brew install node"),
]


def report_prereqs(home: Path) -> None:
    info("")
    info("依赖检查：")
    for cmd, label, hint in PREREQS:
        path = shutil.which(cmd)
        if path:
            info(f"  {C_OK}✓{C_END} {label:<16} {path}")
        else:
            info(f"  {C_WARN}✗{C_END} {label:<16} {hint}")
    font = home / "Library" / "Fonts" / "IoskeleyMono"
    if font.exists():
        info(f"  {C_OK}✓{C_END} {'Ioskeley Mono':<16} {pretty(font, home)}")
    else:
        info(f"  {C_WARN}✗{C_END} {'Ioskeley Mono':<16} 可选，Ghostty 会回退到系统等宽字体")


# --------------------------------------------------------------------------- secrets

def scan_secrets(paths: list[Path]) -> list[tuple[Path, str]]:
    hits = []
    for path in paths:
        if is_binary(path):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                hits.append((path, pattern.pattern))
                break
    return hits


def repo_text_files() -> list[Path]:
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules", "__pycache__"}]
        for name in filenames:
            out.append(Path(dirpath) / name)
    return out


# --------------------------------------------------------------------------- main

def main() -> int:
    global BACKUP_ROOT

    parser = argparse.ArgumentParser(description="本机 ⇄ 仓库 配置同步")
    parser.add_argument("command", choices=["status", "export", "apply"])
    parser.add_argument("--home", default=os.path.expanduser("~"))
    parser.add_argument("--groups", default=",".join(DEFAULT_GROUPS))
    parser.add_argument("--only", default="")
    parser.add_argument("--with-claude-code", action="store_true",
                        help="连 claude-code 组一起处理（默认只处理 terminal）")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-packages", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    home = Path(args.home).expanduser().resolve()
    manifest = load_manifest()
    token = manifest.get("homeToken", "{{HOME}}")
    groups = [g.strip() for g in args.groups.split(",") if g.strip()]
    if args.with_claude_code and "claude-code" not in groups:
        groups.append("claude-code")
    only = {x.strip() for x in args.only.split(",") if x.strip()}

    BACKUP_ROOT = home / f".mac-dev-setup-backup-{time.strftime('%Y%m%d_%H%M%S')}"

    entries = []
    for entry in manifest["entries"]:
        if only and entry["id"] not in only:
            continue
        if entry.get("group", "terminal") not in groups:
            continue
        entries.append(entry)

    if not entries:
        fail("没有匹配的 entry，检查 --groups / --only")
        return 2

    info(f"{'预览' if args.dry_run else '执行'}：{args.command}  (HOME={home})")
    info("")

    skip_claude = "claude-code" in groups and not (home / ".claude").exists()
    if skip_claude:
        info(f"{C_DIM}跳过 claude-code 组：本机没有 ~/.claude（只在装了 Claude Code 的机器上安装）{C_END}")
        entries = [e for e in entries if e.get("group") != "claude-code"]

    for entry in entries:
        if args.command == "status":
            info(status_entry(entry, home, token))
        elif args.command == "export":
            info(export_entry(entry, home, token, args.dry_run))
        else:
            group_missing = entry.get("group") == "claude-code" and not (home / ".claude").exists()
            if group_missing:
                continue
            info(apply_entry(entry, home, token, args.dry_run))

    if args.command == "apply":
        info("")
        info("收尾：")
        hook_pii_guard(home, args.dry_run)
        if not args.no_packages:
            hook_pi_packages(home, args.dry_run)
        if any(e.get("group") == "claude-code" for e in entries):
            hook_launchagent(home, args.dry_run)
        report_prereqs(home)
        info("")
        info("提示：zellij 的配置要新开窗口才生效；Ghostty 配置可用 ghostty-reload 热重载。")
        if (home / ".pi" / "agent" / "auth.json").exists():
            info("提示：检测到已有 pi 登录态；全新机器首次运行 pi 时按提示登录即可。")
        else:
            info(f"{C_WARN}提示：没有 pi 登录态，首次运行 pi 后按提示登录（auth.json 不入库）{C_END}")

    if args.command == "export":
        hits = [] if args.force else scan_secrets(repo_text_files())
        if hits:
            info("")
            fail("发现疑似凭证，已停止（确认安全后加 --force）：")
            for path, pattern in hits:
                print(f"  {path.relative_to(ROOT)}  ← /{pattern}/")
            return 2
        info("")
        info("下一步：git diff 看改动 → git add -A && git commit")

    if args.command == "apply" and backupped and not args.dry_run:
        info("")
        info(f"原文件已备份到 {pretty(BACKUP_ROOT, home)}（{len(backupped)} 个）")

    return 0


if __name__ == "__main__":
    sys.exit(main())
