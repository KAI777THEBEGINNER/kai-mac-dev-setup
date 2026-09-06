#!/usr/bin/env python3
"""火山引擎录音文件识别 2.0 极速版批量转写 —— 音频目录 → 带时间戳逐字稿(md)

用法:
  /usr/bin/python3 ~/.pi/agent/scripts/volc_vc_transcribe.py [音频目录] [--out 输出目录] [--dry-run]

行为:
  - 对目录下每个 mp3/m4a/wav 等音频:同步识别 → 输出同名 .md 逐字稿(带时间戳)
  - 输出目录里已有同名 .md 的文件自动跳过(断点续传,不重复扣额度)
  - 识别速度约实时 70 倍以上,22 个文件约 10-20 分钟

认证(双头):X-Api-App-Key = APP ID,X-Api-Access-Key = Access Token
凭据(二选一):
  1. 环境变量 APP_ID / VC_TOKEN
  2. ~/.config/volc_vc.env,内容两行: APP_ID=xxx / VC_TOKEN=xxx
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

FLASH_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash"
RESOURCE_ID = "volc.bigasr.auc_turbo"
AUDIO_EXTS = (".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mp4")
LANGUAGE = "zh-CN"
MAX_RETRY = 2


def load_creds():
    app_id = os.environ.get("APP_ID")
    token = os.environ.get("VC_TOKEN")
    env_file = os.path.expanduser("~/.config/volc_vc.env")
    if not (app_id and token) and os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("APP_ID="):
                    app_id = line.split("=", 1)[1]
                elif line.startswith("VC_TOKEN="):
                    token = line.split("=", 1)[1]
    if not (app_id and token):
        sys.exit("缺少凭据:请设置环境变量 APP_ID 和 VC_TOKEN,或写入 ~/.config/volc_vc.env")
    return app_id, token


def recognize(app_id, token, audio_path):
    """同步识别一个音频,返回 [(text, start_ms, end_ms), ...]"""
    with open(audio_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = audio_path.rsplit(".", 1)[-1].lower()
    if ext == "m4a":
        ext = "mp4"  # 接口用 mp4 表示 m4a
    body = {
        "app": {"appid": app_id, "token": token, "cluster": RESOURCE_ID},
        "user": {"uid": "kyle_gmat"},
        "audio": {"data": b64, "format": ext, "rate": 16000, "bits": 16, "channels": 1},
        "request": {"model_name": "bigmodel", "enable_punc": True, "use_itn": True, "language": LANGUAGE},
    }
    headers = {
        "X-Api-App-Key": app_id,
        "X-Api-Access-Key": token,
        "X-Api-Resource-Id": RESOURCE_ID,
        "X-Api-Request-Id": f"kyle-{int(time.time()*1000)%10**10}-{os.getpid()}",
        "X-Api-Sequence": "-1",
        "Content-Type": "application/json",
    }
    payload = json.dumps(body).encode()
    last_err = None
    for attempt in range(MAX_RETRY + 1):
        try:
            req = urllib.request.Request(FLASH_URL, data=payload, headers=headers)
            with urllib.request.urlopen(req, timeout=900) as resp:
                resp_data = json.loads(resp.read())
            result = resp_data.get("result") or {}
            utterances = result.get("utterances") or []
            if not utterances and result.get("text"):
                utterances = [{"text": result["text"], "start_time": 0, "end_time": 0}]
            return [(u.get("text", "").strip(), u.get("start_time", 0), u.get("end_time", 0))
                    for u in utterances if u.get("text", "").strip()]
        except Exception as e:
            last_err = e
            if attempt < MAX_RETRY:
                print(f"    重试 {attempt + 1}/{MAX_RETRY}: {e}")
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"识别失败: {last_err}")


def fmt_ts(ms):
    s = max(0, int(ms)) // 1000
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def write_md(audio_path, out_dir, segments):
    title = os.path.splitext(os.path.basename(audio_path))[0]
    lines = [f"# {title}", ""]
    for text, start, end in segments:
        lines.append(f"[{fmt_ts(start)}] {text}")
    out_path = os.path.join(out_dir, title + ".md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return out_path


def collect_audio(in_dir, out_dir):
    todo, done = [], []
    for name in sorted(os.listdir(in_dir)):
        if not name.lower().endswith(AUDIO_EXTS):
            continue
        audio_path = os.path.join(in_dir, name)
        if not os.path.isfile(audio_path):
            continue
        out_path = os.path.join(out_dir, os.path.splitext(name)[0] + ".md")
        if os.path.exists(out_path):
            done.append(name)
        else:
            todo.append(audio_path)
    return todo, done


def main():
    ap = argparse.ArgumentParser(description="火山引擎录音文件识别批量转写")
    ap.add_argument("audio_dir", nargs="?", default="~/Downloads/GMAT_audio",
                    help="音频目录(默认 ~/Downloads/GMAT_audio)")
    ap.add_argument("--out", default="", help="输出目录(默认 <音频目录>/transcripts)")
    ap.add_argument("--dry-run", action="store_true", help="只列出待处理文件,不调 API")
    args = ap.parse_args()

    in_dir = os.path.expanduser(args.audio_dir)
    out_dir = os.path.expanduser(args.out) or os.path.join(in_dir, "transcripts")
    if not os.path.isdir(in_dir):
        sys.exit(f"目录不存在: {in_dir}")

    todo, done = collect_audio(in_dir, out_dir)
    print(f"音频目录: {in_dir}")
    print(f"待转写: {len(todo)} 个,已跳过(已有逐字稿): {len(done)} 个")
    for p in todo:
        size_mb = os.path.getsize(p) / 1024 / 1024
        print(f"  - {os.path.basename(p)} ({size_mb:.1f} MB)")
    if args.dry_run or not todo:
        return

    os.makedirs(out_dir, exist_ok=True)
    app_id, token = load_creds()

    ok, failed = 0, []
    t0 = time.time()
    for i, p in enumerate(todo, 1):
        name = os.path.basename(p)
        size_mb = os.path.getsize(p) / 1024 / 1024
        print(f"[{i}/{len(todo)}] {name} ({size_mb:.0f} MB)…", flush=True)
        t1 = time.time()
        try:
            segments = recognize(app_id, token, p)
            out_path = write_md(p, out_dir, segments)
            ok += 1
            print(f"  ✓ 完成 {len(segments)} 句,耗时 {time.time()-t1:.0f}s → {os.path.basename(out_path)}", flush=True)
        except Exception as e:
            failed.append(name)
            print(f"  ✗ 失败: {e}", flush=True)

    elapsed = time.time() - t0
    print(f"\n全部结束: 成功 {ok} 个,失败 {len(failed)} 个,总耗时 {elapsed/60:.1f} 分钟")
    if failed:
        print("失败清单(重跑脚本可自动续传):")
        for n in failed:
            print(f"  - {n}")
    print(f"逐字稿输出到: {out_dir}")


if __name__ == "__main__":
    main()
