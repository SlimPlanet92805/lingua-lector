#!/usr/bin/env python3
"""Assembles dist/lingua-lector.html from src/part1..part6 and examples/*.json.

Zero-build-tool by design: this just concatenates the HTML fragments in
order and substitutes the __BOOK_CHAPTERS_PLACEHOLDER__ token in part3 with
the embedded default book data (all chapters, in reading order).
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
EXAMPLES = ROOT / "examples"
DIST = ROOT / "dist" / "lingua-lector.html"

PART_FILES = [
    "part1_head.html",
    "part2_body.html",
    "part3_js_core.html",
    "part4_js_import.html",
    "part5_js_render.html",
    "part6_js_init.html",
]

# Chapter manifest, in book reading order. Each id maps to
# examples/heyking_<id>.json (a flat array of paragraph strings).
CHAPTER_MANIFEST = [
    ("vorwort", "Vorwort", ""),
    ("einleitung", "Einleitung", ""),
    ("chile_valparaiso", "Chile (Valparaiso)", "Juli 1886 bis Februar 1889"),
    ("indien_kalkutta", "Indien (Kalkutta)", "Juni 1889 bis April 1893"),
    ("erholungsurlaub", "Erholungsurlaub", "April 1893 bis Februar 1894"),
    ("aegypten_kairo", "Ägypten (Kairo)", "Februar 1894 bis April 1896"),
    ("china1_peking", "China I (Peking)", "April 1896 bis September 1897"),
    ("china2_kiautschou", "China II (Erwerbung von Kiautschou)", "Oktober 1897 bis Juni 1899"),
    ("urlaubsjahr_berlin", "Ein Urlaubsjahr in Berlin", "Juni 1899 bis Mai 1900"),
    ("mexiko", "Mexiko", "Mai 1900 bis Februar 1903"),
    ("heimkehr_europa", "Heimkehr nach Europa", "Februar 1903 bis Juni 1904"),
    ("namenregister", "Namenregister", ""),
]


def build_book_chapters():
    chapters = []
    for chapter_id, title, date_range in CHAPTER_MANIFEST:
        path = EXAMPLES / f"heyking_{chapter_id}.json"
        paragraphs = json.loads(path.read_text(encoding="utf-8"))
        chapters.append({
            "id": chapter_id,
            "title": title,
            "dateRange": date_range,
            "paragraphs": paragraphs,
        })
    return chapters


def main():
    chapters = build_book_chapters()
    chapters_json = json.dumps(chapters, ensure_ascii=False)

    html_parts = []
    for name in PART_FILES:
        html_parts.append((SRC / name).read_text(encoding="utf-8"))
    html = "\n".join(html_parts)

    placeholder = "__BOOK_CHAPTERS_PLACEHOLDER__"
    count = html.count(placeholder)
    if count != 1:
        raise SystemExit(f"expected exactly 1 occurrence of {placeholder}, found {count}")
    html = html.replace(placeholder, chapters_json)

    DIST.parent.mkdir(parents=True, exist_ok=True)
    DIST.write_text(html, encoding="utf-8")

    total_chars = sum(len(p) for c in chapters for p in c["paragraphs"])
    print(f"wrote {DIST} ({len(html):,} bytes html, {total_chars:,} chars of book text, {len(chapters)} chapters)")


if __name__ == "__main__":
    main()
