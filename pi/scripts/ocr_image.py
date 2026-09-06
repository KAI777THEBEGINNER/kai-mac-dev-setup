#!/usr/bin/env python3
"""快速读图 OCR（deepseek 等不支持图像输入的模型读图专用）。

用法：/usr/bin/python3 ~/.pi/agent/scripts/ocr_image.py <图片路径> [更多图片...]
依赖：rapidocr（pip 用户级安装，~/.zshrc 无需配置）
"""
import sys

from rapidocr import RapidOCR

def ocr(engine, path: str) -> None:
    print(f"===== {path} =====")
    result = engine(path)
    # rapidocr 3.x：result.txts 为全部识别文本；老版本遍历 (box, text, score)
    if hasattr(result, "txts"):
        for line in result.txts:
            if line.strip():
                print(line)
    else:
        for item in result:
            text = item[1] if isinstance(item, (list, tuple)) and len(item) > 1 else str(item)
            if text.strip():
                print(text)
    print()

def main() -> None:
    if len(sys.argv) < 2:
        print("用法：ocr_image.py <图片路径> [更多图片...]")
        sys.exit(1)
    engine = RapidOCR()
    for path in sys.argv[1:]:
        try:
            ocr(engine, path)
        except Exception as e:  # 单张失败不中断后续
            print(f"[失败] {path}: {e}")

if __name__ == "__main__":
    main()
