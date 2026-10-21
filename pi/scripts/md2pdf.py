#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Markdown -> PDF（纯本地，无浏览器、无 LaTeX）
依赖：/usr/bin/python3 自带的 reportlab；字体用系统 STHeiti（含中文字形）
用法：python3 md2pdf.py <input.md> <output.pdf>
"""
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, ListFlowable,
                                ListItem, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)

LIGHT = "/System/Library/Fonts/STHeiti Light.ttc"
MEDIUM = "/System/Library/Fonts/STHeiti Medium.ttc"
pdfmetrics.registerFont(TTFont("CJK", LIGHT, subfontIndex=0))
pdfmetrics.registerFont(TTFont("CJKB", MEDIUM, subfontIndex=0))
pdfmetrics.registerFontFamily("CJK", normal="CJK", bold="CJKB",
                              italic="CJK", boldItalic="CJKB")

BLUE = colors.HexColor("#1f4e79")
GRID = colors.HexColor("#c9d3de")
HEAD_BG = colors.HexColor("#eef3f9")
ROW_ALT = colors.HexColor("#fafbfd")
QUOTE_BG = colors.HexColor("#f5f7fa")

ss = getSampleStyleSheet()
S = {
    "h1": ParagraphStyle("h1", fontName="CJKB", fontSize=18, leading=24,
                         textColor=colors.HexColor("#14243a"), spaceAfter=2, alignment=TA_LEFT),
    "h2": ParagraphStyle("h2", fontName="CJKB", fontSize=12.5, leading=17, textColor=BLUE),
    "h3": ParagraphStyle("h3", fontName="CJKB", fontSize=11, leading=15,
                         textColor=colors.HexColor("#233b53"), spaceBefore=6, spaceAfter=2),
    "body": ParagraphStyle("body", fontName="CJK", fontSize=10, leading=15.5,
                           textColor=colors.HexColor("#1a1a1a"), spaceBefore=1.5, spaceAfter=1.5),
    "quote": ParagraphStyle("quote", fontName="CJK", fontSize=9, leading=13.5,
                            textColor=colors.HexColor("#41505f"), backColor=QUOTE_BG,
                            borderColor=colors.HexColor("#c3cfdd"), borderWidth=0,
                            leftIndent=6, rightIndent=4, borderPadding=(5, 6, 5, 6),
                            spaceBefore=3, spaceAfter=4, wordWrap="CJK"),
    "bullet": ParagraphStyle("bullet", fontName="CJK", fontSize=10, leading=15,
                             leftIndent=12, bulletIndent=3, spaceBefore=1, spaceAfter=1),
    "cell": ParagraphStyle("cell", fontName="CJK", fontSize=8.6, leading=12.4, wordWrap="CJK"),
    "cellh": ParagraphStyle("cellh", fontName="CJKB", fontSize=8.8, leading=12.4, wordWrap="CJK"),
    "foot": ParagraphStyle("foot", fontName="CJK", fontSize=7.5, leading=9,
                           textColor=colors.HexColor("#8a97a5")),
}


def inline(text: str) -> str:
    """markdown 行内标记 -> reportlab 标签（先转义，再替换）"""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", text)
    def _code(m):
        c = m.group(1)
        face = "Courier" if c.isascii() else "CJK"
        return '<font face="%s" size="8.6">%s</font>' % (face, c)
    text = re.sub(r"`([^`]+)`", _code, text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<link href="\2">\1</link>', text)
    # 裸 URL 也做成可点
    text = re.sub(r"(?<!href=\")(https?://[^\s<\u4e00-\u9fff]+)",
                  r'<font color="#1f4e79"><link href="\1">\1</link></font>', text)
    return text


def h2_flowable(text: str):
    bar = Table([["", Paragraph(text, S["h2"])]], colWidths=[2.6 * mm, None])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), BLUE),
        ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 0),
        ("LEFTPADDING", (1, 0), (1, 0), 6), ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (0, 0), 5), ("BOTTOMPADDING", (0, 0), (0, 0), 5),
        ("TOPPADDING", (1, 0), (1, 0), 3), ("BOTTOMPADDING", (1, 0), (1, 0), 3),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return bar


def split_row(line: str):
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def col_widths(rows, total, size=8.6, pad=8.5):
    """列宽：以每列「第三长」的单元格为参照（不被个别长文本绑架），
    短列给足自身宽度，剩余宽度按参照比例分给长列。"""
    n = max(len(r) for r in rows)
    need, nat = [], []
    for c in range(n):
        ws = []
        for r in rows:
            cell = (r[c] if c < len(r) else "").replace("**", "")
            ws.append(pdfmetrics.stringWidth(cell, "CJK", size))
        ws.sort(reverse=True)
        need.append(ws[min(2, len(ws) - 1)] + pad)
        nat.append(max(ws) + pad)
    cap = 38 * mm if n <= 3 else 30 * mm
    short_idx = [i for i, x in enumerate(need) if x <= cap]
    fixed = sum(min(nat[i], cap) for i in short_idx)
    rest = max(total - fixed, total * 0.35)
    long_idx = [i for i in range(n) if i not in short_idx]
    long_need = sum(need[i] for i in long_idx)
    out = []
    for i in range(n):
        if i in short_idx:
            out.append(min(nat[i], cap))
        else:
            out.append(need[i] * rest / long_need if long_need else rest / max(1, len(long_idx)))
    scale = total / sum(out)
    return [x * scale for x in out]


def _old_col_widths(rows, total, size=8.6, pad=8.5):
    n = max(len(r) for r in rows)
    nat = []
    for c in range(n):
        w = 0.0
        for r in rows:
            cell = (r[c] if c < len(r) else "").replace("**", "")
            w = max(w, pdfmetrics.stringWidth(cell, "CJK", size))
        nat.append(w + pad)
    if sum(nat) <= total:
        s = sum(nat)
        return [x * total / s for x in nat]
    short_idx = [i for i, x in enumerate(nat) if x <= 30 * mm]
    fixed = sum(min(nat[i], 26 * mm) for i in short_idx)
    rest = total - fixed
    long_nat = sum(nat[i] for i in range(n) if i not in short_idx)
    out = []
    for i, x in enumerate(nat):
        if i in short_idx:
            out.append(min(x, 26 * mm))
        else:
            out.append(x * rest / long_nat if long_nat else rest / max(1, n - len(short_idx)))
    return out


def parse(md: str, width: float):
    flow = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        if not line.strip():
            i += 1
            continue

        # 表格
        if line.lstrip().startswith("|") and i + 1 < len(lines) and set(lines[i + 1].strip()) <= set("|-: "):
            rows = [split_row(line)]
            i += 2
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            ncol = max(len(r) for r in rows)
            rows = [r + [""] * (ncol - len(r)) for r in rows]
            data = [[Paragraph(inline(c), S["cellh"]) for c in rows[0]]]
            data += [[Paragraph(inline(c), S["cell"]) for c in r] for r in rows[1:]]
            long_cols = [c for c in range(ncol) if max(len(r[c]) for r in rows) > 32]
            for r_i, row in enumerate(data):
                for c_i, para in enumerate(row):
                    if c_i not in long_cols:
                        para.style = ParagraphStyle(f"c{c_i}_{r_i}", parent=para.style, wordWrap=None)
            w = col_widths(rows, width)
            t = Table(data, colWidths=w, repeatRows=1, hAlign="LEFT")
            style = [
                ("GRID", (0, 0), (-1, -1), 0.5, GRID),
                ("BACKGROUND", (0, 0), (-1, 0), HEAD_BG),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
            ]
            for r in range(1, len(rows)):
                if r % 2 == 0:
                    style.append(("BACKGROUND", (0, r), (-1, r), ROW_ALT))
            t.setStyle(TableStyle(style))
            flow += [Spacer(1, 3), t, Spacer(1, 4)]
            continue

        # 标题
        if line.startswith("## "):
            flow += [Spacer(1, 7), h2_flowable(inline(line[3:])), Spacer(1, 3)]
            i += 1
            continue
        if line.startswith("### "):
            flow.append(Paragraph(inline(line[4:]), S["h3"]))
            i += 1
            continue
        if line.startswith("# "):
            flow.append(Paragraph(inline(line[2:]), S["h1"]))
            i += 1
            continue

        # 分隔线
        if re.match(r"^-{3,}$", line.strip()):
            flow.append(Spacer(1, 4))
            i += 1
            continue

        # 引用块
        if line.lstrip().startswith(">"):
            buf = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                buf.append(lines[i].lstrip()[1:].strip())
                i += 1
            flow.append(Paragraph(inline(" ".join(buf)), S["quote"]))
            continue

        # 列表
        if re.match(r"^\s*[-*] ", line):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                items.append(Paragraph(inline(re.sub(r"^\s*[-*] ", "", lines[i])), S["bullet"]))
                i += 1
            for it in items:
                flow.append(Paragraph(it.text if hasattr(it, "text") else str(it),
                                      S["bullet"], bulletText="•"))
            continue
        if re.match(r"^\s*\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\. ", lines[i]):
                items.append(Paragraph(inline(re.sub(r"^\s*\d+\. ", "", lines[i])), S["bullet"]))
                i += 1
            flow.append(ListFlowable([ListItem(p, leftIndent=14) for p in items],
                                     bulletType="1", bulletFormat="%s.",
                                     bulletFontName="CJK", bulletFontSize=9, leftIndent=14))
            continue

        # 普通段落
        flow.append(Paragraph(inline(line.strip()), S["body"]))
        i += 1
    return flow


def build(md_path: str, pdf_path: str):
    md = open(md_path, encoding="utf-8").read()
    doc = BaseDocTemplate(pdf_path, pagesize=A4,
                          leftMargin=13 * mm, rightMargin=13 * mm,
                          topMargin=14 * mm, bottomMargin=14 * mm,
                          title="27Fall 申请费明细", author="")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")

    def footer(canv, d):
        canv.saveState()
        canv.setFont("CJK", 7.5)
        canv.setFillColor(colors.HexColor("#8a97a5"))
        canv.drawRightString(doc.pagesize[0] - doc.rightMargin, 8.5 * mm, f"{canv.getPageNumber()}")
        canv.restoreState()

    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=footer)])
    doc.build(parse(md, doc.width))
    print("PDF ->", pdf_path)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
