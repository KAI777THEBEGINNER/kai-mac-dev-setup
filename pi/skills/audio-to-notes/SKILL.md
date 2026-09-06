---
name: audio-to-notes
description: |
  B 站视频合集 / 本地音频目录 → 云端逐字稿 → LLM 归档精读笔记。三段流水线:
  1. yt-dlp 把 B 站合集全部音频下载为 mp3(可选,已有音频可跳过)
  2. 火山引擎录音文件识别 2.0 极速版批量转写 —— 纯云端 API,约实时 70 倍速度,
     9 小时音频 20 分钟内出全部逐字稿,不占本地算力
  3. (可选)LLM 把逐字稿按科目归档整理为精读笔记
  触发方式: /audio-to-notes <合集URL或音频目录> [--skip-download] [--notes]
metadata:
  version: 1.0.0
---

# 音频 → 逐字稿 → 笔记

把一门网课 / 一个视频合集变成结构化知识笔记,全程云端,本地零算力负担。

> 这是一个执行型 skill。读到这份文档的 Claude 按下面的 playbook 一步步操作;不要问用户「要不要开始」,直接做,每个阶段切换给一行进度即可。

---

## 依赖定位

| 组件 | 路径 | 说明 |
|------|------|------|
| yt-dlp | `~/.local/bin/yt-dlp` | 独立二进制(brew 在 pre-release macOS 上会失败,不要重装) |
| ffmpeg | `/opt/homebrew/bin/ffmpeg` | 音频抽取依赖,如缺 PATH 用 `--ffmpeg-location` 显式指定 |
| 转写脚本 | `~/.pi/agent/scripts/volc_vc_transcribe.py` | 批量转写,断点续传,免重装 |
| 凭据 | `~/.config/volc_vc.env` | 两行: `APP_ID=xxx` / `VC_TOKEN=xxx`,权限 600,敏感文件 |

检查:`[ -x ~/.local/bin/yt-dlp ]` 和 `[ -f ~/.pi/agent/scripts/volc_vc_transcribe.py ]`,缺哪个修哪个(yt-dlp 从 GitHub releases 下载独立二进制)。

## 阶段一:下载 B 站合集音频(可选)

合集 URL 形如 `https://space.bilibili.com/<uid>/channel/collectiondetail?sid=<id>`。

```bash
cd <工作目录>   # 输出目录,如 ~/Downloads/<课程名>_audio
~/.local/bin/yt-dlp -f "ba/b" -x --audio-format mp3 --audio-quality 0 \
  -o "%(playlist_index)02d_%(title)s.%(ext)s" "<合集URL>"
```

关键坑:
- **不要用 `--flat-playlist` 限制列表**——合集多分 P 在真实下载时才会全部展开(22 个分 P 的合集,flat 列表只显示 5 条)
- 文件名保持中文没问题,脚本已处理;不要加 `--restrict-filenames`
- 下载完 `ls` 确认数量与分 P 一致,再进阶段二

## 阶段二:云端转写(核心)

```bash
/usr/bin/python3 ~/.pi/agent/scripts/volc_vc_transcribe.py <音频目录> [--dry-run]
```

- 脚本自动读 `~/.config/volc_vc.env` 凭据,对目录下每个 mp3/m4a/wav 调火山 flash 接口
- 输出到 `<音频目录>/transcripts/` 同名 `.md`,每句带 `[HH:MM:SS]` 时间戳
- **断点续传**:已有同名 md 自动跳过,中途失败重跑脚本即可,不重复扣额度
- 先 `--dry-run` 列清单确认数量,再正式跑
- 22 个文件约 10-20 分钟;单文件最大 86MB 也一次成功,不用分片

转写期间可挂 Monitor 盯进度(脚本逐行输出 `[i/N] 文件名` 和 `✓ 完成`,失败会打 `✗ 失败`),失败清单在结尾打印,重跑自动续传。

### 额度说明

- 新用户免费 20 小时,按**音频时长**扣减(9.3 小时音频 ≈ 用掉 9.3 小时)
- 用量统计:https://console.volcengine.com/speech/new/usage-statistics (登录态,浏览器看)

## 阶段三:LLM 归档整理(可选)

转写完成后,按科目/主题把逐字稿分组,并行 subagent 每组产出一份精读笔记:

- 每组 agent 只读自己那组逐字稿文件,输出 `<科目>_精读笔记.md`
- **数据保真铁律**:只归纳逐字稿里有的内容;转录不清/数据矛盾处保留课程结论并注明,禁止编造
- 输出目录:默认 `<音频目录>/notes/`

用户若说「另请 session 做整理」,本 skill 到此结束,只交付逐字稿。

## 已知坑速查

| 症状 | 原因 | 修法 |
|------|------|------|
| `'latin-1' codec can't encode` | 中文进了 HTTP header | 脚本内 Request ID 已是纯 ASCII(`kyle-<ts>-<pid>`),不要改回含文件名 |
| HTTP 401 | 凭据错 / 服务未开通 | 检查 `~/.config/volc_vc.env`;注意控制台 Access Token 会被掩码,取完整值要点「显示」或从设置里复制 |
| `app key not found in header or query` | 认证组合错 | flash 接口用双头: `X-Api-App-Key`=APP ID + `X-Api-Access-Key`=Access Token,不要用 `X-Api-Key` 或 `Authorization: Bearer;` |
| `45000000 unmapped key` | body 里带 `additions` 字段 | 删掉,flash 接口不需要 |

## 不在 skill 范围内的事

- 不做说话人分离 / 翻译 / 总结——只产逐字稿和结构化笔记
- 不本地转写(podcast-transcribe 才是本地方案,本 skill 明确走云端)
- 不要把逐字稿回填进对话上下文,几十万字会吃掉上下文,给文件路径
