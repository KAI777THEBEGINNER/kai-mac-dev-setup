---
name: epub-to-obsidian
description: |
  将 EPUB 电子书或 TXT 文本按章节切分为 Markdown，输出到 Obsidian 知识库。
  自动提取图片到 images/ 子目录，重写为相对路径，零模型占用。
  支持嵌套 TOC 解析、同一 HTML 文件内多 fragment 切分、中文数字章节识别。
  触发方式：/epub-to-obsidian <文件路径1> [文件路径2 ...] [--output <目录>]
metadata:
  version: 1.0.0
---

# EPUB/TXT → Obsidian Markdown

将电子书按物理章节切分为独立的 `.md` 文件，直接落地到 Obsidian vault，供 RAG / 阅读 / 笔记使用。

> 执行型 skill。按 playbook 直接操作；不问「要不要开始」。每个阶段切换给一行进度即可。

---

## 依赖

- `python3`
- `ebooklib`
- `beautifulsoup4`
- `html2text`

检查 & 安装：

```bash
python3 -c "import ebooklib, bs4, html2text" 2>/dev/null || pip3 install ebooklib beautifulsoup4 html2text --quiet
```

---

## 参数

- `$FILES` — 必填，一个或多个 `.epub` / `.txt` 文件路径（支持空格分隔的多个路径）
- `$OUTPUT_DIR` — 可选，默认：
  `/Users/zhaoziqi/Library/Mobile Documents/iCloud~md~obsidian/Documents/kai_vault/Think Different/书籍`

---

## Playbook

### Step 1 依赖检查

运行依赖检查命令。若缺失，自动静默安装。给用户一行：

```
依赖就绪：ebooklib, beautifulsoup4, html2text
```

---

### Step 2 确定输出目录

若用户通过 `--output` 指定了目录，使用该目录；否则使用默认 Obsidian vault 路径。

---

### Step 3 执行转换

调用 skill 自带脚本：

```bash
python3 ~/.pi/agent/skills/epub-to-obsidian/scripts/convert_epubs.py \
  --output "$OUTPUT_DIR" \
  "$FILES"
```

脚本内部逻辑：

1. **EPUB 处理**
   - 用 `ebooklib` 解析 TOC（支持嵌套 Section + Link）
   - 按 `basename(href)` 分组章节
   - 提取所有图片到 `images/`
   - 同一 HTML 文件含多个 fragment → 用 BeautifulSoup 按 body 子节点切分
   - `html2text` 转 Markdown，重写图片路径为 `images/filename`
   - 文件名格式：`01-章节名.md`

2. **TXT 处理**
   - 正则匹配 `章[一二三四五六七八九十百千零〇廿卅\d]+`
   - 按章节切分，每章独立文件

---

### Step 4 结果报告

转换完成后给用户一个汇总表格：

```
| 书籍 | 章节数 | 图片数 |
|------|--------|--------|
| ...  | ...    | ...    |
```

---

## 输出规范

```
<OUTPUT_DIR>/
├── <书籍名称>/
│   ├── 01-章节一.md
│   ├── 02-章节二.md
│   ├── ...
│   └── images/
│       ├── image001.jpg
│       └── ...
└── <另一本书籍>/
    └── ...
```

- 章节文件前缀为补零两位或三位数字，保证 Obsidian 文件树排序
- Markdown 内图片路径为相对路径：`![描述](images/filename.jpg)`
- 零深度学习模型占用

---

## 不在 skill 范围内的事

- 不处理 PDF、MOBI、AZW3 等格式
- 不做 OCR（EPUB 内图片中的文字不提取）
- 不自动翻译内容
- 不修改源文件
