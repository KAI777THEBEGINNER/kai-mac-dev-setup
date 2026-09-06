---
name: ppt-screenshot-pptx
description: |
  将 PPTX 的每一页渲染为高清 PNG 截图，再按顺序合成一个新的纯截图版 PPTX。
  依赖：macOS + Microsoft PowerPoint + python-pptx + PyMuPDF。
  触发方式：/ppt-screenshot-pptx
metadata:
  version: 1.0.0
---

# PPT 截图版生成器

把 PPTX 逐页转成高清截图，再拼成一个新 PPTX。适用于需要纯图片版幻灯片、防止内容被编辑、或兼容展示的场景。

---

## 依赖

- macOS（调用 Microsoft PowerPoint 的 AppleScript）
- Microsoft PowerPoint for Mac
- Python 3 + pip

```bash
pip3 install python-pptx pymupdf -i https://pypi.tuna.tsinghua.edu.cn/simple
```

---

## 用法

直接运行脚本，传入输入 PPTX 路径：

```bash
python3 ppt_screenshot.py /path/to/your.pptx
```

输出文件会生成在同目录，命名为 `your_screenshots.pptx`。

---

## 脚本文件

同目录下的 `ppt_screenshot.py` 可直接运行：

```bash
python3 ppt_screenshot.py /path/to/your.pptx
```
