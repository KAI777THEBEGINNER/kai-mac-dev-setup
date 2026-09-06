---
name: docx-to-md
description: |
  将 .docx 文件一键转换为 markdown，支持英文博客/播客转录稿的自动中英双语排版。
  提取 docx 段落结构，保留标题层级；若内容为英文，可询问并追加中文翻译。
  排版风格：Speaker 标签加粗、中文翻译用引用块缩进、段落间空行分隔。
  触发方式：/docx-to-md <docx_path> [output_dir]
metadata:
  version: 1.0.0
---

# DOCX 转 Markdown

把 Word 文档转成结构化 markdown。对英文播客/博客转录稿，可一键追加中文翻译并排版。

> 执行型 skill。按 playbook 直接操作；除翻译确认外不问「要不要开始」。每个阶段切换给一行进度即可。

---

## 依赖

- `python3`（系统自带）
- `python-docx`

检查 & 安装：

```bash
python3 -c "import docx" 2>/dev/null || pip3 install python-docx --quiet
```

---

## 参数

- `$DOCX_PATH` — 必填，docx 文件路径
- `$OUTPUT_DIR` — 可选，默认用 docx 所在目录

---

## Playbook

### Step 1 提取原始 Markdown

用 python-docx 读取段落，按样式映射为 markdown：

```python
from docx import Document
doc = Document(DOCX_PATH)
lines = []
for p in doc.paragraphs:
    style = p.style.name
    text = p.text
    if style == 'Heading 1':
        lines.append(f"# {text}")
    elif text.strip():
        lines.append(text)
    else:
        lines.append("")
```

原始 md 保存到 `$OUTPUT_DIR/<stem>.md`。

**确认文件写出后**，给用户一行：`原始 md 已输出: <path> (<size>)`

---

### Step 2 判断是否需要翻译

扫描原始 md 前 50 个非空行：

- 若英文单词占比 > 60%，判定为英文内容 → **询问用户**："检测到内容为英文，是否需要追加中文翻译并输出双语版？"
- 用户拒绝 → 结束
- 用户同意 → 继续 Step 3
- 若不是英文内容 → 结束

---

### Step 3 翻译

读取原始 md，逐行处理。规则：

- **Speaker 标签**（`^Speaker [0-9]+  ·  `）：保留原文，不翻译
- **标题行**（`^# `）：保留原文，不翻译（双语版中标题下方追加一行中文标题）
- **元数据行**（如 `Transcribed YYYY-MM-DD`）：保留原文，不翻译
- **空行**：保留空行
- **其他英文内容行**：在下方插入一行中文翻译

**短文档**（≤ 300 行）：直接在当前对话中翻译，无需分片。

**长文档**（> 300 行）：分片并行翻译，避免上下文溢出。

#### 分片策略

1. 把原始 md 按 150 行为一片切成 N 个 chunk
2. 每个 chunk 写一个临时文件 `/tmp/d2m_chunk_N.txt`
3. 并行派出 N 个子代理，每个代理翻译自己的 chunk
   - 代理读取 chunk 文件
   - 按上述规则翻译
   - 输出到 `/tmp/d2m_bilingual_N.md`
4. 收集所有 chunk，按序拼接
5. **去重检查**：检查相邻 chunk 的边界行，若最后一行与下一 chunk 第一行重复（通常是 Speaker 标签跨边界），删除重复行

子代理 prompt 模板（关键规则）：

```
你负责翻译一段 podcast/blog 转录稿的 chunk。

输入文件: /tmp/d2m_chunk_N.txt
输出文件: /tmp/d2m_bilingual_N.md

规则：
1. 保留每一行的原始顺序，不增不减
2. Speaker 标签行（如 "Speaker 0  ·  0:00:00"）保留原样，不要翻译
3. 空行保持空行
4. 每个非空英文内容行，在它正下方插入一行中文翻译
5. 技术术语保留英文：SaaS, API, LLM, ROI, M&A, MCP, KPI, Buy402, GPT-5, Claude 4.6, JSON, PDF 等
6. 不要在开头加标题或说明，直接输出翻译后的正文
7. 用 Write 工具写入输出文件
```

---

### Step 4 双语排版

翻译后的 raw bilingual 需要统一格式化。用脚本处理：

```python
import re

with open(bilingual_path) as f:
    lines = f.readlines()

result = []
first_speaker = False

for line in lines:
    s = line.rstrip('\n')
    
    # 标题保持
    if s.startswith('#'):
        result.append(s)
        continue
    
    # Speaker 标签加粗
    if re.match(r'^Speaker [0-9]+\s+·\s+', s):
        if first_speaker:
            if result and result[-1] != '':
                result.append('')  # 段前空行
        else:
            first_speaker = True
        result.append(f'**{s}**')
        continue
    
    # 空行保持
    if not s.strip():
        result.append('')
        continue
    
    # 中文翻译行 → 引用块
    if re.search(r'[一-鿿]', s):
        result.append(f'> {s}')
        continue
    
    # 其他（英文内容）保持原样
    result.append(s)

with open(bilingual_path, 'w') as f:
    f.write('\n'.join(result) + '\n')
```

输出文件：`$OUTPUT_DIR/<stem>_bilingual.md`

**确认写出后**，给用户一行：`双语版已输出: <path> (<size>)`

---

## 输出示例

**原始版：**

```markdown
# Orchestrating the New Machine Economy
Transcribed 2026-05-03 20:57

**Speaker 0  ·  0:00:00**
Imagine a $500,000 corporate shipping dispute.

**Speaker 1  ·  0:00:05**
Right, which is already a nightmare scenario for any company.
```

**双语版：**

```markdown
# Orchestrating the New Machine Economy
# 编排新机器经济
Transcribed 2026-05-03 20:57

**Speaker 0  ·  0:00:00**
Imagine a $500,000 corporate shipping dispute.
> 想象一下一笔 50 万美元的企业航运纠纷。

**Speaker 1  ·  0:00:05**
Right, which is already a nightmare scenario for any company.
> 对，这本身就已经是任何公司都不愿面对的噩梦场景了。
```

---

## 不在 skill 范围内的事

- 不处理 docx 中的图片、表格、复杂样式（仅提取纯文本段落）
- 不处理非英文内容的翻译
- 不主动删除或修改源 docx
