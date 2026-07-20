#!/usr/bin/env python3
"""Download the original-resolution images exposed by a public Xiaohongshu share page.

Use only for public posts and material you are permitted to save.
Usage: python3 xhs_image_demo.py '<share-url>' [output-directory]
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def state_from_page(page: str) -> dict:
    """Read the JS object assigned to window.__INITIAL_STATE__ from public note HTML.

    XHS emits a few JavaScript-only `undefined` values, so normalize those before
    decoding the otherwise JSON-compatible payload.
    """
    match = re.search(r"window\.__INITIAL_STATE__\s*=\s*({.*?})\s*</script>", page, re.S)
    if not match:
        raise RuntimeError("Page initial state was not found (the post may require login or be unavailable).")
    payload = re.sub(r":undefined(?=[,}])", ":null", match.group(1))
    return json.loads(html.unescape(payload))


def find_note(state: object) -> dict:
    """Locate the note object rather than depending on a volatile state path."""
    if isinstance(state, dict):
        images = state.get("imageList")
        if isinstance(images, list) and images:
            return state
        for value in state.values():
            try:
                return find_note(value)
            except LookupError:
                pass
    elif isinstance(state, list):
        for value in state:
            try:
                return find_note(value)
            except LookupError:
                pass
    raise LookupError("No image note was found in the page state.")


def highest_image_url(image: dict) -> str:
    """Prefer WB_DFT/original-style URL over preview derivatives supplied by the page."""
    info = image.get("infoList") or []
    for preferred in ("WB_DFT", "WB_ORI", "WB_PRV"):
        for item in info:
            if item.get("imageScene") == preferred and item.get("url"):
                return item["url"]
    for key in ("urlDefault", "url", "urlPre"):
        if image.get(key):
            return image[key]
    raise ValueError("Image record has no downloadable URL")


def extension(response: requests.Response, source_url: str) -> str:
    kind = response.headers.get("content-type", "").split(";", 1)[0].lower()
    known = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
    if kind in known:
        return known[kind]
    suffix = Path(urlparse(source_url).path).suffix
    return suffix if suffix and len(suffix) <= 5 else ".jpg"


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: python3 xhs_image_demo.py '<share-url>' [output-directory]")
    share_url = sys.argv[1]
    out = Path(sys.argv[2] if len(sys.argv) == 3 else "xhs_download")
    out.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    page = session.get(share_url, timeout=30)
    page.raise_for_status()
    print(f"Resolved URL: {page.url}")

    note = find_note(state_from_page(page.text))
    title = note.get("title") or "untitled"
    images = note["imageList"]
    print(f"Title: {title}\nImages: {len(images)}")

    for index, image in enumerate(images, 1):
        url = highest_image_url(image).replace("http://", "https://", 1)
        response = session.get(url, headers={"Referer": "https://www.xiaohongshu.com/"}, timeout=60)
        response.raise_for_status()
        filename = out / f"{index:02d}{extension(response, url)}"
        filename.write_bytes(response.content)
        print(f"Saved {filename} ({len(response.content):,} bytes; {image.get('width')}x{image.get('height')})")


if __name__ == "__main__":
    main()
