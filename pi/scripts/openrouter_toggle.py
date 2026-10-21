#!/usr/bin/python3
"""openrouter 凭证开关 —— 让 /model 列表里的 openrouter 模型整体出现或消失。

原理：pi 的 /model 列表只列出「已配置凭证的 provider」的模型（ModelRuntime 的
available snapshot = configuredProviders 过滤后的全集）。所以把 openrouter 凭证
从 auth.json 摘出去，403 个 openrouter 模型就整体从列表消失（同时也暂时不可用）；
放回来即恢复。凭证本身不丢失，只是搬到 auth.disabled/ 目录寄存。

用法：
    openrouter_toggle.py off      摘掉凭证（/model 里不再出现 openrouter）
    openrouter_toggle.py on       放回凭证
    openrouter_toggle.py status   查看当前状态
"""

import json
import os
import sys
import time

AGENT_DIR = os.path.expanduser("~/.pi/agent")
AUTH = os.path.join(AGENT_DIR, "auth.json")
STASH_DIR = os.path.join(AGENT_DIR, "auth.disabled")
STASH = os.path.join(STASH_DIR, "openrouter.json")
PROVIDER = "openrouter"


def acquire_lock(path, timeout=15.0):
    """与 pi 的 proper-lockfile 互斥：它锁的是 <path>.lock 目录。"""
    lockdir = path + ".lock"
    deadline = time.time() + timeout
    while True:
        try:
            os.mkdir(lockdir)
            return lockdir
        except FileExistsError:
            if time.time() > deadline:
                raise SystemExit("✗ auth.json 正被 pi 占用，稍后再试")
            time.sleep(0.1)


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        text = f.read().strip()
    return json.loads(text) if text else default


def atomic_write(path, data):
    tmp = path + ".tmp-openrouter-toggle"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def cmd_off():
    lock = acquire_lock(AUTH)
    try:
        auth = read_json(AUTH, {}) or {}
        if PROVIDER not in auth:
            print("● openrouter 凭证已处于摘除状态（/model 里没有 openrouter 模型）")
            return 0
        credential = auth[PROVIDER]
        os.makedirs(STASH_DIR, exist_ok=True)
        os.chmod(STASH_DIR, 0o700)
        atomic_write(STASH, credential)
        del auth[PROVIDER]
        atomic_write(AUTH, auth)
    finally:
        os.rmdir(lock)
    print("✓ 已摘除 openrouter 凭证 → /model 列表不再出现 openrouter 模型")
    print("  凭证寄存于：" + STASH)
    print("  恢复命令：/usr/bin/python3 %s on" % os.path.abspath(__file__))
    return 0


def cmd_on():
    lock = acquire_lock(AUTH)
    try:
        auth = read_json(AUTH, {}) or {}
        if PROVIDER in auth:
            print("● openrouter 凭证已生效（/model 里已有 openrouter 模型）")
            return 0
        stashed = read_json(STASH)
        if stashed is None:
            print("✗ 找不到寄存的凭证：%s" % STASH)
            print("  请用 /login openrouter 重新登录，或从 auth.json.bak-* 里找回")
            return 1
        auth[PROVIDER] = stashed
        atomic_write(AUTH, auth)
    finally:
        os.rmdir(lock)
    try:
        os.remove(STASH)
        if not os.listdir(STASH_DIR):
            os.rmdir(STASH_DIR)
    except OSError:
        pass
    print("✓ 已放回 openrouter 凭证 → /model 列表恢复 openrouter 模型")
    return 0


def cmd_status():
    lock = acquire_lock(AUTH)
    try:
        auth = read_json(AUTH, {}) or {}
    finally:
        os.rmdir(lock)
    active = PROVIDER in auth
    stashed = os.path.exists(STASH)
    print("openrouter 凭证：" + ("生效中（/model 里会列出 openrouter 模型）" if active else "已摘除"))
    if active:
        kind = auth[PROVIDER].get("type", "unknown")
        print("  凭证类型：" + kind)
    if stashed:
        print("  寄存文件：" + STASH)
    if not active and not stashed:
        print("  ⚠️ 既没有生效凭证也没有寄存文件，说明凭证已丢失")
    return 0


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    command = args[0].lower()
    if command == "off":
        return cmd_off()
    if command == "on":
        return cmd_on()
    if command == "status":
        return cmd_status()
    print("未知命令：%s（可用：off / on / status）" % args[0])
    return 2


if __name__ == "__main__":
    sys.exit(main())
