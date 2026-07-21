#!/usr/bin/env python3
"""Download original-resolution images from a public Xiaohongshu share page.

Parity with Worker `worker/xhs/parse.ts`:
  - Prefer bare fileId/token → https://sns-img-bd.xhscdn.com/{token}
  - Optional --jpg appends ?imageView2/2/w/0/format/jpg (CDN JPG, not WB_DFT)
  - Extract token from page URLs (strip !suffix; webpic skip ts/hash)
  - Tolerate non-image/* Content-Type when magic bytes match

Use only for public posts and material you are permitted to save.
Usage:
  python3 xhs_image_demo.py '<share-url>' [output-directory]
  python3 xhs_image_demo.py '<share-url>' [output-directory] --jpg
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote, urlparse

import requests

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

ORIGINAL_CDN_HOST = "sns-img-bd.xhscdn.com"
FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


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


def is_valid_file_id(file_id: object) -> bool:
    if not isinstance(file_id, str):
        return False
    token = file_id.strip()
    if not token:
        return False
    if re.search(r"[/?#\s]", token):
        return False
    return bool(FILE_ID_RE.match(token))


def normalize_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    if value.startswith("//"):
        return "https:" + value
    if value.startswith("http://"):
        return "https://" + value[len("http://") :]
    return value


def extract_file_id_from_url(raw_url: str) -> str | None:
    """Extract opaque CDN token from a page-provided image URL.

    - Strip `!nd_…` transformation suffixes
    - webpic hosts: path is `/{ts}/{hash}/{fileId}!suffix` → skip first two segments
    - other hosts: path after host is the token
    """
    normalized = normalize_url(raw_url)
    if not normalized:
        return None
    try:
        parsed = urlparse(normalized)
    except Exception:
        return None
    segments = [s for s in parsed.path.split("/") if s]
    if not segments:
        return None
    host = (parsed.hostname or "").lower()
    if "webpic" in host:
        if len(segments) < 3:
            return None
        token_path = "/".join(segments[2:])
    else:
        token_path = "/".join(segments)
    token = token_path.split("!", 1)[0].strip()
    return token if is_valid_file_id(token) else None


def highest_image_url(image: dict) -> str:
    """Prefer WB_DFT/original-style URL over preview derivatives supplied by the page."""
    info = image.get("infoList") or []
    for preferred in ("WB_DFT", "WB_ORI", "WB_HQ", "WB_PRV"):
        for item in info:
            if item.get("imageScene") == preferred and item.get("url"):
                return item["url"]
    for key in ("urlDefault", "url", "urlPre"):
        if image.get(key):
            return image[key]
    raise ValueError("Image record has no downloadable URL")


def candidate_urls_for_token(image: dict) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()

    def push(value: object) -> None:
        if not isinstance(value, str):
            return
        trimmed = value.strip()
        if not trimmed or trimmed in seen:
            return
        seen.add(trimmed)
        urls.append(trimmed)

    info = image.get("infoList") or []
    for preferred in ("WB_DFT", "WB_ORI", "WB_HQ", "WB_PRV"):
        for item in info:
            if item.get("imageScene") == preferred:
                push(item.get("url"))
    for item in info:
        push(item.get("url"))
    for key in ("urlDefault", "url", "urlPre"):
        push(image.get(key))
    return urls


def resolve_token(image: dict) -> str | None:
    fid = image.get("fileId")
    if is_valid_file_id(fid):
        return str(fid).strip()
    for url in candidate_urls_for_token(image):
        token = extract_file_id_from_url(url)
        if token:
            return token
    return None


def original_url_from_file_id(file_id: str, host: str = ORIGINAL_CDN_HOST) -> str:
    if not is_valid_file_id(file_id):
        raise ValueError("INVALID_FILE_ID")
    return f"https://{host}/{quote(file_id.strip(), safe='')}"


def jpg_url_from_file_id(file_id: str, host: str = ORIGINAL_CDN_HOST) -> str:
    if not is_valid_file_id(file_id):
        raise ValueError("INVALID_FILE_ID")
    return f"https://{host}/{quote(file_id.strip(), safe='')}?imageView2/2/w/0/format/jpg"


def resolve_image_source_url(image: dict, prefer_jpg: bool = False) -> str:
    token = resolve_token(image)
    if token:
        return jpg_url_from_file_id(token) if prefer_jpg else original_url_from_file_id(token)
    return highest_image_url(image)


def sniff_image_extension(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[4:8] == b"ftyp":
        brand = data[8:12].lower()
        if brand in (b"avif", b"avis"):
            return ".avif"
        if brand in (b"heic", b"heix", b"hevc", b"hevx"):
            return ".heic"
        if brand in (b"heif", b"mif1", b"msf1"):
            return ".heic"
    return None


def extension(response: requests.Response, source_url: str, body: bytes) -> str:
    kind = response.headers.get("content-type", "").split(";", 1)[0].lower()
    known = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
        "image/heic": ".heic",
        "image/heif": ".heic",
    }
    if kind in known:
        return known[kind]
    sniffed = sniff_image_extension(body)
    if sniffed:
        return sniffed
    suffix = Path(urlparse(source_url).path).suffix
    return suffix if suffix and len(suffix) <= 5 else ".jpg"


def parse_args(argv: list[str]) -> tuple[str, Path, bool]:
    if len(argv) < 2:
        raise SystemExit(
            "Usage: python3 xhs_image_demo.py '<share-url>' [output-directory] [--jpg]"
        )
    prefer_jpg = False
    positional: list[str] = []
    for arg in argv[1:]:
        if arg in ("--jpg", "--prefer-jpg"):
            prefer_jpg = True
            continue
        if arg.startswith("-"):
            raise SystemExit(f"Unknown flag: {arg}")
        positional.append(arg)
    if not positional:
        raise SystemExit(
            "Usage: python3 xhs_image_demo.py '<share-url>' [output-directory] [--jpg]"
        )
    share_url = positional[0]
    out = Path(positional[1] if len(positional) > 1 else "xhs_download")
    return share_url, out, prefer_jpg


def main() -> None:
    share_url, out, prefer_jpg = parse_args(sys.argv)
    out.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    page = session.get(share_url, timeout=30)
    page.raise_for_status()
    print(f"Resolved URL: {page.url}")
    print(f"Mode: {'CDN JPG (imageView2)' if prefer_jpg else 'bare original (sns-img-bd)'}")

    note = find_note(state_from_page(page.text))
    title = note.get("title") or "untitled"
    images = note["imageList"]
    print(f"Title: {title}\nImages: {len(images)}")

    for index, image in enumerate(images, 1):
        token = resolve_token(image)
        try:
            url = resolve_image_source_url(image, prefer_jpg=prefer_jpg).replace(
                "http://", "https://", 1
            )
        except Exception as exc:
            print(f"Skip image {index}: {exc}")
            continue

        response = session.get(
            url, headers={"Referer": "https://www.xiaohongshu.com/"}, timeout=60
        )
        response.raise_for_status()
        body = response.content
        content_type = response.headers.get("content-type", "")
        # Tolerate true images with non-image/* types (octet-stream HEIC, etc.).
        if not content_type.lower().startswith("image/") and sniff_image_extension(body) is None:
            print(f"Skip image {index}: response is not an image ({content_type!r})")
            continue

        filename = out / f"{index:02d}{extension(response, url, body)}"
        filename.write_bytes(body)
        token_note = f" token={token}" if token else " (page URL fallback)"
        print(
            f"Saved {filename} ({len(body):,} bytes; "
            f"{image.get('width')}x{image.get('height')}; {url}{token_note})"
        )


if __name__ == "__main__":
    main()
