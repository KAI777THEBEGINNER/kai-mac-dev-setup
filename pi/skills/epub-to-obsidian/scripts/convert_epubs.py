#!/usr/bin/env python3
"""
EPUB/TXT → 按章节切分 Markdown（Obsidian/RAG 友好）
零模型占用，纯 Python 轻量级实现
"""
import os
import sys
import re
import argparse
from pathlib import Path
from urllib.parse import unquote
from collections import defaultdict
from bs4 import BeautifulSoup
from bs4.element import Tag

try:
    import ebooklib
    from ebooklib import epub
except ImportError:
    print("[错误] 缺少 ebooklib，请先执行: pip3 install ebooklib")
    sys.exit(1)

try:
    import html2text
except ImportError:
    print("[错误] 缺少 html2text，请先执行: pip3 install html2text")
    sys.exit(1)

DEFAULT_OUTPUT = "{{HOME}}/Library/Mobile Documents/iCloud~md~obsidian/Documents/kai_vault/Think Different/书籍"


def sanitize_filename(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", name)
    name = name.strip(". ")
    return name if name else "untitled"


def rewrite_image_paths(md_text, images_dir_name="images"):
    def repl(match):
        alt = match.group(1)
        src = match.group(2)
        if src.startswith(f"{images_dir_name}/"):
            return match.group(0)
        fname = os.path.basename(unquote(src))
        if not fname:
            return match.group(0)
        return f"![{alt}]({images_dir_name}/{fname})"
    return re.sub(r"!\[(.*?)\]\((.*?)\)", repl, md_text)


def extract_images_from_epub(epub_path, book_folder):
    images_dir = os.path.join(book_folder, "images")
    os.makedirs(images_dir, exist_ok=True)
    image_items = []
    book = epub.read_epub(epub_path)
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_IMAGE:
            fname = os.path.basename(item.get_name())
            out_path = os.path.join(images_dir, fname)
            with open(out_path, "wb") as f:
                f.write(item.get_content())
            image_items.append(fname)
    return images_dir, image_items


def walk_toc(items, chapters, parent_title=None):
    for item in items:
        if isinstance(item, ebooklib.epub.Link):
            chapters.append({"title": item.title, "href": item.href, "parent": parent_title})
        elif isinstance(item, tuple):
            if len(item) == 0:
                continue
            first = item[0]
            section_title = None
            if hasattr(first, 'title'):
                section_title = first.title
            elif isinstance(first, str):
                section_title = first

            children_list = None
            for sub in item[1:]:
                if isinstance(sub, list):
                    children_list = sub
                    break

            if len(item) >= 2 and isinstance(item[1], ebooklib.epub.Link):
                link = item[1]
                title = link.title
                if section_title and title:
                    title = f"{section_title} | {title}"
                chapters.append({"title": title or section_title or "Untitled", "href": link.href, "parent": parent_title})

            if children_list:
                walk_toc(children_list, chapters, parent_title=section_title or parent_title)
        elif isinstance(item, list):
            walk_toc(item, chapters, parent_title=parent_title)


def get_toc_chapters(epub_path):
    book = epub.read_epub(epub_path)
    chapters = []
    if book.toc:
        walk_toc(book.toc, chapters)
    return chapters


def html_to_md(html_bytes_or_str):
    if isinstance(html_bytes_or_str, bytes):
        html = html_bytes_or_str.decode("utf-8", errors="replace")
    else:
        html = html_bytes_or_str
    h = html2text.HTML2Text()
    h.ignore_links = False
    h.ignore_images = False
    h.body_width = 0
    h.wrap_list_items = False
    md = h.handle(html)
    return md.strip()


def split_html_by_fragments(soup, fragment_links):
    body = soup.find("body") or soup

    frag_entries = []
    for link in fragment_links:
        fid = link.get("fragment")
        if not fid:
            continue
        el = soup.find(id=fid) or soup.find(attrs={"name": fid})
        if el:
            frag_entries.append((fid, link["title"], el))

    if not frag_entries:
        return [{"title": fragment_links[0]["title"], "soup": soup}]

    order = {id(el): i for i, el in enumerate(body.next_elements)}
    frag_entries.sort(key=lambda x: order.get(id(x[2]), float("inf")))

    buckets = [[] for _ in frag_entries]
    bucket_idx = 0
    import copy as _copy

    for child in body.children:
        for i, (fid, title, fel) in enumerate(frag_entries):
            if child is fel:
                bucket_idx = i
                break
            if isinstance(child, Tag) and child.find(id=fid):
                bucket_idx = i
                break
        buckets[bucket_idx].append(_copy.copy(child))

    results = []
    for i, (fid, title, fel) in enumerate(frag_entries):
        new_soup = BeautifulSoup("", "html.parser")
        for child in buckets[i]:
            new_soup.append(child)
        results.append({"title": title, "soup": new_soup})

    return results


def process_epub(epub_path, book_folder):
    print(f"  解析 EPUB 结构...")
    extract_images_from_epub(epub_path, book_folder)
    chapters = get_toc_chapters(epub_path)

    if not chapters:
        print("  [警告] 未找到 TOC，按文档粒度切分...")
        fallback_by_document(epub_path, book_folder)
        return

    book = epub.read_epub(epub_path)
    doc_by_href = {}
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            doc_by_href[os.path.basename(item.get_name())] = item

    file_links = defaultdict(list)
    for ch in chapters:
        href = ch["href"]
        clean_href = href.split("#")[0].split("?")[0]
        basename = os.path.basename(clean_href)
        fragment = href.split("#")[1] if "#" in href else None
        ch["fragment"] = fragment
        file_links[basename].append(ch)

    all_results = []
    for basename, links in file_links.items():
        item = doc_by_href.get(basename)
        if not item:
            print(f"  [跳过] 找不到文档: {basename}")
            continue

        soup = BeautifulSoup(item.get_content(), "html.parser")
        if len(links) == 1:
            all_results.append({"title": links[0]["title"], "soup": soup})
        else:
            split_results = split_html_by_fragments(soup, links)
            all_results.extend(split_results)

    total = len(all_results)
    digits = 2 if total < 100 else 3

    for i, res in enumerate(all_results):
        title = res["title"]
        soup = res["soup"]
        md = html_to_md(str(soup))
        md = rewrite_image_paths(md)

        safe_title = sanitize_filename(title)
        prefix = f"{i + 1:0{digits}d}"
        fname = f"{prefix}-{safe_title}.md"
        if len(fname) > 120:
            fname = f"{prefix}-{safe_title[:60]}.md"

        with open(os.path.join(book_folder, fname), "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n{md}")
        print(f"    已生成: {fname}")


def fallback_by_document(epub_path, book_folder):
    book = epub.read_epub(epub_path)
    idx = 0
    docs = [item for item in book.get_items() if item.get_type() == ebooklib.ITEM_DOCUMENT]
    digits = 2 if len(docs) < 100 else 3
    for item in docs:
        idx += 1
        md = html_to_md(item.get_content())
        md = rewrite_image_paths(md)
        soup = BeautifulSoup(item.get_content(), "html.parser")
        h1 = soup.find("h1")
        title = h1.get_text(strip=True) if h1 else f"chapter-{idx}"
        safe_title = sanitize_filename(title)
        fname = f"{idx:0{digits}d}-{safe_title}.md"
        if len(fname) > 120:
            fname = f"{idx:0{digits}d}-{safe_title[:60]}.md"
        with open(os.path.join(book_folder, fname), "w", encoding="utf-8") as f:
            f.write(f"# {title}\n\n{md}")
        print(f"    已生成: {fname}")


def split_txt_by_chapters(txt_path, book_folder):
    print(f"  读取 TXT...")
    with open(txt_path, "r", encoding="utf-8") as f:
        content = f.read()

    chap_re = re.compile(r"^(\s*章[一二三四五六七八九十百千零〇廿卅\d]+)\s*$", re.MULTILINE)
    matches = list(chap_re.finditer(content))

    if not matches:
        print("  [警告] 未识别到章节，输出为单一文件")
        with open(os.path.join(book_folder, "01-全文.md"), "w", encoding="utf-8") as f:
            f.write(content)
        return

    total = len(matches)
    digits = 2

    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < total else len(content)
        section_text = content[start:end].strip()

        chap_title = m.group(1).strip()
        safe_title = sanitize_filename(chap_title)
        prefix = f"{i + 1:0{digits}d}"
        fname = f"{prefix}-{safe_title}.md"

        with open(os.path.join(book_folder, fname), "w", encoding="utf-8") as f:
            f.write(section_text)
        print(f"    已生成: {fname}")


def main():
    parser = argparse.ArgumentParser(description="EPUB/TXT → Markdown 章节切分")
    parser.add_argument("--output", "-o", default=DEFAULT_OUTPUT, help="目标输出目录")
    parser.add_argument("files", nargs="+", help="输入的 epub/txt 文件路径")
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    for src in args.files:
        if not os.path.exists(src):
            print(f"\n[跳过] 文件不存在: {src}")
            continue

        basename = os.path.basename(src)
        book_name = re.sub(r"\s*\(z-library\.sk.*?\)\s*", "", basename)
        book_name = re.sub(r"\s*\(.*?z-lib.*?\)\s*", "", book_name)
        book_name = os.path.splitext(book_name)[0].strip()

        print(f"\n转换: 《{book_name}》")

        book_folder = os.path.join(args.output, sanitize_filename(book_name))
        os.makedirs(book_folder, exist_ok=True)

        if src.lower().endswith(".epub"):
            process_epub(src, book_folder)
        elif src.lower().endswith(".txt"):
            split_txt_by_chapters(src, book_folder)
        else:
            print(f"  [跳过] 不支持的格式")

        print(f"  输出: {book_folder}")


if __name__ == "__main__":
    main()
