#!/usr/bin/env python3
"""Download public share-link media (Xiaohongshu + Douyin public pages + fallbacks).

Backends
  auto      Xiaohongshu → original CDN; Douyin → public share page; else KuKuTool
  xhs       Direct original-quality images from the public note page
  douyin    Direct images from the public Douyin share page (no watermark)
  kukutool  dy.kukutool.com encrypted parse API (watermark-free, 130+ sites)
  bugpk     api.bugpk.com plaintext fallback (no encryption)

Usage
  python3 download_share.py '<share-url-or-copied-text>' [-o DIR] [--backend auto] [--jpg] [--include-covers]
  python3 download_share.py --help

This script only fetches media the public page / third-party parser already
exposes. It does not bypass login, DRM, signed-URL expiry tricks, or paywalls.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
import random
import re
import string
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import requests
from cryptography.hazmat.primitives import padding as crypto_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

XHS_HOSTS = ("xiaohongshu.com", "xhslink.com", "xhslink.cn", "rednote.com")
DOUYIN_HOSTS = ("douyin.com", "iesdouyin.com")
ORIGINAL_CDN_HOST = "sns-img-bd.xhscdn.com"
CI_HOST = "ci.xiaohongshu.com"
DOUYIN_MOBILE_UA = (
    "Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36 "
    "(KHTML, like Gecko) SamsungBrowser/14.2 Chrome/87.0.4280.141 Mobile Safari/537.36"
)
# Bare tokens, or CDN path prefixes such as notes_pre_post/<token>.
FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$")

# KuKuTool (dy.kukutool.com) — reverse-engineered from videodl + site JS
KUKU_BASE = "https://dy.kukutool.com"
KUKU_AUTH = "/api/auth-9e25f1"
KUKU_PARSE = "/api/parse"
KUKU_AES_KEY = b"12345678901234567890123456789013"  # 32-byte AES-256-CBC key
STANDARD_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
CUSTOM_B64 = "ZYXABCDEFGHIJKLMNOPQRSTUVWzyxabcdefghijklmnopqrstuvw9876543210-_"
CUSTOM_TO_STD = str.maketrans(CUSTOM_B64, STANDARD_B64)

BUGPK_URL = "https://api.bugpk.com/api/short_videos"

# Residential-looking Chinese prefixes used only as X-Forwarded-For decoys.
# Avoid 123.56/8 — that is this host's egress and is already auto_script-flagged.
_CN_PREFIXES = (
    (36, 99), (42, 80), (58, 60), (60, 12), (111, 206),
    (112, 64), (113, 88), (114, 80), (117, 136), (120, 36),
    (183, 60), (218, 76), (223, 104),
)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def chrome_headers(referer: str = "https://dy.kukutool.com/en") -> dict[str, str]:
    return {
        "User-Agent": CHROME_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://dy.kukutool.com",
        "Referer": referer,
        "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    }


def random_cn_ip() -> str:
    a, b = random.choice(_CN_PREFIXES)
    return f"{a}.{b}.{random.randint(1, 254)}.{random.randint(1, 254)}"


def extract_url(text: str) -> str:
    """Pull the first http(s) share URL out of copied Xiaohongshu share text."""
    match = re.search(r"https?://[^\s\"'<>，。；！？、\u200b]+", text)
    if not match:
        raise SystemExit("No http(s) URL found in the input.")
    return match.group(0).rstrip(").,;]")


def is_xhs_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in XHS_HOSTS)


def is_douyin_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in DOUYIN_HOSTS)


def sanitize_filename(text: str, default: str = "note") -> str:
    text = re.sub(r"[^\u4e00-\u9fffa-zA-Z0-9._-]+", "_", text or "")
    text = re.sub(r"_+", "_", text).strip("._-")
    return (text or default)[:80]


def sniff_image_ext(data: bytes) -> str | None:
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
        if brand in (b"heic", b"heix", b"hevc", b"hevx", b"heif", b"mif1", b"msf1"):
            return ".heic"
    if data[:4] == b"\x00\x00\x00\x18" and data[4:8] == b"ftyp":
        return ".mp4"
    if data[4:8] == b"ftyp":
        return ".mp4"
    if data[:3] == b"ID3" or data[:2] == b"\xff\xfb":
        return ".mp3"
    return None


def sniff_video_ext(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data[4:8] == b"ftyp" or data[:4] == b"\x00\x00\x00\x1c":
        return ".mp4"
    if data[:4] == b"RIFF" and data[8:12] == b"AVI ":
        return ".avi"
    if data[:4] == b"\x1aE\xdf\xa3":
        return ".webm"
    return None


def image_dimensions(path: Path, data: bytes) -> tuple[int | None, int | None]:
    ext = sniff_image_ext(data)
    if ext == ".heic":
        try:
            from pillow_heif import register_heif_opener  # type: ignore

            register_heif_opener()
        except Exception:
            return None, None
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return None, None


def new_session(extra_headers: dict[str, str] | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": CHROME_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
    if extra_headers:
        s.headers.update(extra_headers)
    return s


# ---------------------------------------------------------------------------
# Xiaohongshu original-quality path
# ---------------------------------------------------------------------------

def xhs_state_from_page(page: str) -> dict:
    match = re.search(r"window\.__INITIAL_STATE__\s*=\s*({.*?})\s*</script>", page, re.S)
    if match:
        payload = re.sub(r":undefined(?=[,}])", ":null", match.group(1))
        return json.loads(html.unescape(payload))
    marker = "window.__INITIAL_STATE__="
    pos = page.rfind(marker)
    if pos == -1:
        raise RuntimeError("Page initial state was not found (login wall or unavailable).")
    start = page.find("{", pos + len(marker))
    if start == -1:
        raise RuntimeError("window.__INITIAL_STATE__ has no object.")
    depth = 0
    in_string = None
    escaped = False
    end = None
    for i in range(start, len(page)):
        ch = page[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_string:
                in_string = None
            continue
        if ch in {'"', "'"}:
            in_string = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise RuntimeError("window.__INITIAL_STATE__ braces are unbalanced.")
    payload = re.sub(r":\s*undefined(?=\s*[,}])", ": null", page[start:end])
    return json.loads(payload)


def xhs_find_note(state: object) -> dict:
    if isinstance(state, dict):
        images = state.get("imageList")
        if isinstance(images, list) and images:
            return state
        for value in state.values():
            try:
                return xhs_find_note(value)
            except LookupError:
                pass
    elif isinstance(state, list):
        for value in state:
            try:
                return xhs_find_note(value)
            except LookupError:
                pass
    raise LookupError("No image note was found in the page state.")


def is_valid_file_id(file_id: object) -> bool:
    if not isinstance(file_id, str):
        return False
    token = file_id.strip()
    if not token or ".." in token or re.search(r"[?#\s]", token):
        return False
    return bool(FILE_ID_RE.match(token))


def extract_file_id_from_url(raw_url: str) -> str | None:
    value = (raw_url or "").strip()
    if value.startswith("//"):
        value = "https:" + value
    try:
        parsed = urlparse(value)
    except Exception:
        return None
    segments = [s for s in parsed.path.split("/") if s]
    if not segments:
        return None
    host = (parsed.hostname or "").lower()
    token_path = "/".join(segments[2:] if "webpic" in host and len(segments) >= 3 else segments)
    token = token_path.split("!", 1)[0].strip()
    return token if is_valid_file_id(token) else None


def xhs_resolve_token(image: dict) -> str | None:
    fid = image.get("fileId")
    if is_valid_file_id(fid):
        return str(fid).strip()
    urls: list[str] = []
    info = image.get("infoList") or []
    for preferred in ("WB_DFT", "WB_ORI", "WB_HQ", "WB_PRV"):
        for item in info:
            if isinstance(item, dict) and item.get("imageScene") == preferred and item.get("url"):
                urls.append(item["url"])
    for item in info:
        if isinstance(item, dict) and item.get("url"):
            urls.append(item["url"])
    for key in ("urlDefault", "url", "urlPre"):
        if image.get(key):
            urls.append(image[key])
    for url in urls:
        token = extract_file_id_from_url(url)
        if token:
            return token
    return None


def xhs_media_url(file_id: str, prefer_jpg: bool) -> str:
    token = quote(file_id.strip(), safe="/")
    if prefer_jpg:
        # Same pixel dimensions as the original, JPEG-encoded. For large
        # notes this is often the 7MB+ file users expect from third-party
        # parsers; native PNG on sns-img-bd can be smaller (better compressed).
        return f"https://{CI_HOST}/{token}?imageView2/format/jpg"
    return f"https://{ORIGINAL_CDN_HOST}/{token}"


# Cover / grid thumbs on image notes are typically 1000–1080px when the same
# note also has large originals. Never treat WB_DFT (~1080p web derivative) as
# the download target — that is the thumbnail, not the original.
COVER_MAX_EDGE = 1080
ORIGINAL_MIN_EDGE = 1600


def xhs_is_cover_or_thumb(image: dict, images: list) -> bool:
    """True for cover cards / preview tiles when the note also has large originals."""
    edge = max(int(image.get("width") or 0), int(image.get("height") or 0))
    if not edge:
        return False
    note_max = 0
    for sibling in images:
        if isinstance(sibling, dict):
            note_max = max(
                note_max,
                int(sibling.get("width") or 0),
                int(sibling.get("height") or 0),
            )
    return note_max >= ORIGINAL_MIN_EDGE and edge <= COVER_MAX_EDGE


def parse_xhs(
    session: requests.Session,
    share_url: str,
    prefer_jpg: bool = False,
    include_covers: bool = False,
) -> dict[str, Any]:
    page = session.get(
        share_url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": "https://www.xiaohongshu.com/",
        },
        timeout=30,
        allow_redirects=True,
    )
    page.raise_for_status()
    note = xhs_find_note(xhs_state_from_page(page.text))
    title = note.get("title") or note.get("desc") or "untitled"
    images = note.get("imageList") or []
    pics: list[str] = []
    skipped_covers = 0
    for image in images:
        if not isinstance(image, dict):
            continue
        if not include_covers and xhs_is_cover_or_thumb(image, images):
            skipped_covers += 1
            continue
        token = xhs_resolve_token(image)
        if token:
            pics.append(xhs_media_url(token, prefer_jpg))
    video_url = ""
    video = note.get("video")
    if isinstance(video, dict):
        media = video.get("media") or {}
        stream = media.get("stream") or {}
        for key in ("h264", "h265", "av1"):
            arr = stream.get(key)
            if isinstance(arr, list) and arr:
                master = arr[0] if isinstance(arr[0], dict) else {}
                video_url = master.get("masterUrl") or master.get("backupUrls", [None])[0] or ""
                if video_url:
                    break
    return {
        "backend": "xhs",
        "title": title,
        "canonical": str(page.url),
        "note_id": note.get("noteId") or note.get("id") or "",
        "url": video_url,
        "cover": "",
        "pics": pics,
        "skipped_covers": skipped_covers,
        "raw_note_keys": sorted(note.keys())[:20],
    }


# ---------------------------------------------------------------------------
# Douyin public share-page path (no KuKuTool)
# ---------------------------------------------------------------------------

def _balanced_json_object(text: str, start: int) -> str:
    """Slice a JSON object starting at `start` (must point at '{')."""
    if start < 0 or start >= len(text) or text[start] != "{":
        raise RuntimeError("JSON object start not found.")
    depth = 0
    in_string: str | None = None
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_string:
                in_string = None
            continue
        if ch in "\"'":
            in_string = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise RuntimeError("Unbalanced JSON object.")


def douyin_router_from_page(page: str) -> dict[str, Any]:
    match = re.search(r"window\._ROUTER_DATA\s*=\s*(\{)", page)
    if not match:
        raise RuntimeError("Douyin page has no window._ROUTER_DATA (login wall or unavailable).")
    payload = _balanced_json_object(page, match.start(1))
    payload = payload.replace("\\u002F", "/")
    payload = re.sub(r":undefined(?=[,}])", ":null", payload)
    return json.loads(payload)


def douyin_find_item(router: dict[str, Any]) -> dict[str, Any]:
    loader = router.get("loaderData") or {}
    if not isinstance(loader, dict):
        raise RuntimeError("Douyin _ROUTER_DATA.loaderData missing.")
    for key, blob in loader.items():
        if not isinstance(blob, dict):
            continue
        video_info = blob.get("videoInfoRes") or blob.get("itemInfo") or {}
        if not isinstance(video_info, dict):
            continue
        items = video_info.get("item_list") or []
        if not items and isinstance(video_info.get("itemStruct"), dict):
            items = [video_info["itemStruct"]]
        if isinstance(items, list) and items and isinstance(items[0], dict):
            item = items[0]
            images = item.get("images") or []
            if isinstance(images, list) and images:
                return item
    raise RuntimeError("Douyin share page has no image-note item (video-only or empty).")


def _douyin_url_score(url: str) -> int:
    """Prefer unsigned-looking original JPEG over watermarked / shrunk variants.

    Live check (v.douyin.com/CHEV1tpvfx4/, 7 images, 2160-wide originals):
      images[].url_list  ~tplv-dy-lqen-new:1440:H:q80.jpeg  → 1440px, ~256–750 KB
      img_bitrate[]      ~q80.jpeg                          → 2160px, ~480 KB JPEG / ~204 KB webp
      download_url_list  ~tplv-dy-lqen-new-water:...        → watermarked, skip
      tplv-dy-shrink                                        → 480/960 preview, skip
    """
    path = url.split("?", 1)[0].lower()
    if "-water" in path or "lqen-new-water" in path:
        return -100
    if "shrink" in path or "resize" in path:
        return -50
    score = 0
    if re.search(r"~q80\.jpeg$", path) or re.search(r"~q\d+\.jpeg$", path):
        score += 80
    elif re.search(r"~q80\.webp$", path) or re.search(r"~q\d+\.webp$", path):
        score += 60
    elif "lqen-new" in path and path.endswith(".jpeg"):
        score += 40
    elif "lqen-new" in path:
        score += 20
    elif path.endswith(".jpeg") or path.endswith(".jpg"):
        score += 30
    elif path.endswith(".webp"):
        score += 10
    return score


def _douyin_collect_urls_for_uri(item: dict[str, Any], uri: str) -> list[str]:
    urls: list[str] = []
    for image in item.get("images") or []:
        if isinstance(image, dict) and image.get("uri") == uri:
            urls.extend(u for u in (image.get("url_list") or []) if isinstance(u, str))
    for gear in item.get("img_bitrate") or []:
        if not isinstance(gear, dict):
            continue
        for image in gear.get("images") or []:
            if isinstance(image, dict) and image.get("uri") == uri:
                urls.extend(u for u in (image.get("url_list") or []) if isinstance(u, str))
    seen: set[str] = set()
    unique: list[str] = []
    for url in urls:
        if url and url not in seen:
            seen.add(url)
            unique.append(url)
    return unique


def douyin_pick_best_url(item: dict[str, Any], image: dict[str, Any]) -> str:
    uri = image.get("uri") or ""
    candidates = _douyin_collect_urls_for_uri(item, uri) if uri else []
    if not candidates:
        candidates = [u for u in (image.get("url_list") or []) if isinstance(u, str)]
    ranked = sorted(candidates, key=_douyin_url_score, reverse=True)
    if not ranked or _douyin_url_score(ranked[0]) < 0:
        raise RuntimeError(f"No watermark-free Douyin image URL for uri={uri!r}")
    return ranked[0]


def parse_douyin(session: requests.Session, share_url: str) -> dict[str, Any]:
    headers = {
        "User-Agent": DOUYIN_MOBILE_UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    page = session.get(share_url, headers=headers, timeout=30, allow_redirects=True)
    page.raise_for_status()
    canonical = str(page.url)
    html_text = page.text

    # iesdouyin.com/share/note/{id} is often a layout shell. Follow to
    # /share/video/{id} or www.douyin.com/share/note/{id} which carry images.
    if "window._ROUTER_DATA" not in html_text or "item_list" not in html_text:
        aweme_id = ""
        m = re.search(r"/(?:share/)?(?:video|note|slides)/(\d{15,})", canonical)
        if not m:
            m = re.search(r"/(?:share/)?(?:video|note|slides)/(\d{15,})", html_text)
        if m:
            aweme_id = m.group(1)
        if aweme_id:
            for alt in (
                f"https://www.iesdouyin.com/share/video/{aweme_id}",
                f"https://www.douyin.com/share/note/{aweme_id}",
                f"https://www.iesdouyin.com/share/slides/{aweme_id}",
            ):
                if alt.rstrip("/") == canonical.rstrip("/"):
                    continue
                alt_page = session.get(alt, headers=headers, timeout=30, allow_redirects=True)
                if alt_page.status_code == 200 and "item_list" in alt_page.text:
                    html_text = alt_page.text
                    canonical = str(alt_page.url)
                    break

    router = douyin_router_from_page(html_text)
    item = douyin_find_item(router)
    images = item.get("images") or []
    pics: list[str] = []
    seen_uri: set[str] = set()
    for image in images:
        if not isinstance(image, dict):
            continue
        uri = image.get("uri") or ""
        if uri and uri in seen_uri:
            continue
        if uri:
            seen_uri.add(uri)
        pics.append(douyin_pick_best_url(item, image))

    video_url = ""
    video = item.get("video") if isinstance(item.get("video"), dict) else {}
    play = (video or {}).get("play_addr") or {}
    if isinstance(play, dict):
        for u in play.get("url_list") or []:
            if isinstance(u, str) and u:
                video_url = u.replace("playwm", "play")
                break

    return {
        "backend": "douyin",
        "title": (item.get("desc") or "").strip(),
        "canonical": canonical,
        "aweme_id": item.get("aweme_id") or item.get("group_id_str") or "",
        "url": video_url if not pics else "",
        "cover": "",
        "pics": pics,
        "raw_item_keys": sorted(item.keys())[:24],
    }


# ---------------------------------------------------------------------------
# KuKuTool encrypted API
# ---------------------------------------------------------------------------

def _uwx_id() -> str:
    alphabet = string.ascii_letters + string.digits
    return "uwx_" + "".join(random.choice(alphabet) for _ in range(12))


def _xor_str(s: str) -> str:
    return "".join(chr(ord(c) ^ 0x5A) for c in s)


def _block_reverse(s: str, block: int = 8) -> str:
    return "".join(s[i : i + block][::-1] for i in range(0, len(s), block))


def _custom_b64_decode(s: str) -> bytes:
    mapped = s.translate(CUSTOM_TO_STD)
    pad = (-len(mapped)) % 4
    mapped += "=" * pad
    return base64.b64decode(mapped)


def kuku_obfuscate_decode(blob: str) -> bytes:
    """XOR 0x5A → 8-char block reverse → custom-b64 → raw bytes."""
    return _custom_b64_decode(_block_reverse(_xor_str(blob)))


def kuku_aes_cbc_decrypt(ciphertext: bytes, iv: bytes) -> bytes:
    cipher = Cipher(algorithms.AES(KUKU_AES_KEY), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = crypto_padding.PKCS7(128).unpadder()
    return unpadder.update(padded) + unpadder.finalize()


def kuku_decrypt_response(data: str, iv: str) -> Any:
    ct = kuku_obfuscate_decode(data)
    iv_bytes = kuku_obfuscate_decode(iv)
    raw = kuku_aes_cbc_decrypt(ct, iv_bytes)
    text = raw.decode("utf-8")
    return json.loads(text)


def kuku_gcm_encrypt(auth_key: str, auth_seed: str, plaintext: str) -> tuple[str, str]:
    key = hashlib.sha256(f"{auth_key}:{auth_seed}".encode("utf-8")).digest()
    iv = os.urandom(12)
    ct_and_tag = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)
    return base64.b64encode(ct_and_tag).decode("ascii"), base64.b64encode(iv).decode("ascii")


def parse_kukutool(session: requests.Session, share_url: str) -> dict[str, Any]:
    decoy_ip = random_cn_ip()
    headers = chrome_headers()
    headers["X-Forwarded-For"] = decoy_ip
    headers["X-Real-IP"] = decoy_ip

    home = session.get(f"{KUKU_BASE}/en", headers=headers, timeout=30)
    home.raise_for_status()

    auth_body = {"requestURL": share_url, "pagePath": "/", "mode": "single"}
    auth = session.post(
        f"{KUKU_BASE}{KUKU_AUTH}",
        headers={**headers, "Content-Type": "application/json"},
        json=auth_body,
        timeout=30,
    )
    if auth.status_code != 200:
        raise RuntimeError(f"KuKuTool auth HTTP {auth.status_code}: {auth.text[:400]}")
    auth_json = auth.json()
    auth_key = auth_json.get("k_9e25f1")
    auth_seed = auth_json.get("s_9e25f1")
    if not auth_key or not auth_seed:
        raise RuntimeError(f"KuKuTool auth missing key/seed: {auth_json}")

    params = {
        "requestURL": share_url,
        "captchaKey": "",
        "captchaInput": "",
        "totalSuccessCount": "0",
        "successCount": "0",
        "firstSuccessDate": "",
        "pagePath": "/",
        "uwx_id": _uwx_id(),
        "isMobile": "false",
        "geoipIp": "",
    }
    plaintext = json.dumps(params, ensure_ascii=False, separators=(",", ":"))
    payload_b64, iv_b64 = kuku_gcm_encrypt(auth_key, auth_seed, plaintext)

    parse_body = {
        "version": 3,
        "k_9e25f1": auth_key,
        "p_9e25f1": payload_b64,
        "r_9e25f1": 1,
        "i_9e25f1": iv_b64,
    }
    parsed = session.post(
        f"{KUKU_BASE}{KUKU_PARSE}",
        headers={**headers, "Content-Type": "application/json"},
        json=parse_body,
        timeout=45,
    )
    if parsed.status_code != 200:
        snippet = parsed.text[:500]
        raise RuntimeError(f"KuKuTool parse HTTP {parsed.status_code}: {snippet}")

    body = parsed.json()
    if body.get("error") or body.get("ticket"):
        ticket = body.get("ticket") or body.get("error")
        raise RuntimeError(f"KuKuTool blocked: {ticket}")
    if body.get("status") not in (0, None) and not body.get("encrypt"):
        raise RuntimeError(f"KuKuTool parse error: {body}")

    if body.get("encrypt"):
        try:
            data = kuku_decrypt_response(body["data"], body["iv"])
        except Exception as exc:
            preview = str(body.get("data", ""))[:80]
            raise RuntimeError(
                f"KuKuTool decrypt failed ({exc}). "
                "Datacenter IPs often receive garbage ciphertext "
                f"(ticket_ip_restricted / auto_script). preview={preview!r}"
            ) from exc
    else:
        data = body.get("data") or body

    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"KuKuTool decrypted non-JSON (likely IP-flagged garbage): {data[:120]!r}"
            ) from exc

    if not isinstance(data, dict):
        raise RuntimeError(f"KuKuTool unexpected payload type: {type(data)}")

    pics = data.get("pics") or data.get("images") or []
    if isinstance(pics, str):
        pics = [pics]
    return {
        "backend": "kukutool",
        "title": data.get("title") or data.get("desc") or "",
        "canonical": share_url,
        "url": data.get("url") or data.get("video") or "",
        "cover": data.get("cover") or "",
        "pics": [p for p in pics if p],
        "raw_keys": sorted(data.keys()),
    }


# ---------------------------------------------------------------------------
# BugPk plaintext fallback
# ---------------------------------------------------------------------------

def parse_bugpk(session: requests.Session, share_url: str) -> dict[str, Any]:
    resp = session.get(BUGPK_URL, params={"url": share_url}, timeout=30)
    resp.raise_for_status()
    body = resp.json()
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, dict):
        raise RuntimeError(f"BugPk unexpected response: {body}")
    pics = data.get("pics") or data.get("images") or []
    if isinstance(pics, str):
        pics = [pics]
    return {
        "backend": "bugpk",
        "title": data.get("title") or "",
        "canonical": share_url,
        "url": data.get("url") or "",
        "cover": data.get("cover") or "",
        "pics": [p for p in pics if p],
        "raw_keys": sorted(data.keys()),
    }


# ---------------------------------------------------------------------------
# Download + verify
# ---------------------------------------------------------------------------

def collect_media_urls(parsed: dict[str, Any]) -> list[tuple[str, str]]:
    """Return (kind, url) in a stable order: images first, then video, then cover."""
    items: list[tuple[str, str]] = []
    seen: set[str] = set()

    def push(kind: str, url: object) -> None:
        if not isinstance(url, str):
            return
        value = url.strip()
        if not value or value in seen:
            return
        seen.add(value)
        items.append((kind, value))

    for pic in parsed.get("pics") or []:
        push("image", pic)
    push("video", parsed.get("url"))
    if not parsed.get("pics"):
        push("cover", parsed.get("cover"))
    return items


def download_one(
    session: requests.Session,
    url: str,
    dest_dir: Path,
    index: int,
    kind: str,
    referer: str,
) -> dict[str, Any]:
    headers = {
        "User-Agent": CHROME_UA,
        "Accept": "image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8",
        "Referer": referer,
    }
    resp = session.get(url, headers=headers, timeout=90, stream=True)
    resp.raise_for_status()
    data = resp.content
    ext = sniff_image_ext(data) or sniff_video_ext(data)
    if ext is None:
        ctype = (resp.headers.get("content-type") or "").split(";", 1)[0].lower()
        ext = {
            "image/jpeg": ".jpg",
            "image/jpg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/heic": ".heic",
            "image/heif": ".heic",
            "video/mp4": ".mp4",
            "application/octet-stream": ".bin",
        }.get(ctype, ".bin")
    path = dest_dir / f"{index:02d}{ext}"
    path.write_bytes(data)
    width = height = None
    if ext in {".jpg", ".png", ".webp", ".gif", ".avif", ".heic"}:
        width, height = image_dimensions(path, data)
    return {
        "index": index,
        "kind": kind,
        "path": str(path),
        "bytes": len(data),
        "ext": ext,
        "content_type": resp.headers.get("content-type", ""),
        "width": width,
        "height": height,
        "url": url,
        "magic": sniff_image_ext(data) or sniff_video_ext(data) or "unknown",
    }


def parse_with_backend(
    session: requests.Session,
    url: str,
    backend: str,
    prefer_jpg: bool = False,
    include_covers: bool = False,
) -> dict[str, Any]:
    if backend == "xhs":
        return parse_xhs(session, url, prefer_jpg=prefer_jpg, include_covers=include_covers)
    if backend == "douyin":
        return parse_douyin(session, url)
    if backend == "kukutool":
        return parse_kukutool(session, url)
    if backend == "bugpk":
        return parse_bugpk(session, url)
    if backend == "auto":
        errors: list[str] = []
        if is_xhs_url(url):
            try:
                return parse_xhs(
                    session, url, prefer_jpg=prefer_jpg, include_covers=include_covers
                )
            except Exception as exc:
                errors.append(f"xhs: {exc}")
        if is_douyin_url(url):
            try:
                return parse_douyin(session, url)
            except Exception as exc:
                errors.append(f"douyin: {exc}")
        try:
            return parse_kukutool(session, url)
        except Exception as exc:
            errors.append(f"kukutool: {exc}")
        try:
            return parse_bugpk(session, url)
        except Exception as exc:
            errors.append(f"bugpk: {exc}")
        raise RuntimeError("All backends failed:\n  - " + "\n  - ".join(errors))
    raise SystemExit(f"Unknown backend: {backend}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("url", help="Share URL, or the whole copied share text")
    parser.add_argument("-o", "--output", default="", help="Output directory")
    parser.add_argument(
        "--backend",
        choices=("auto", "xhs", "douyin", "kukutool", "bugpk"),
        default="auto",
        help="Parser backend (default: auto)",
    )
    parser.add_argument(
        "--jpg",
        action="store_true",
        help="Xiaohongshu: request JPEG via ci.xiaohongshu.com (often 7MB+ for large notes)",
    )
    parser.add_argument(
        "--include-covers",
        action="store_true",
        help="Xiaohongshu: also save cover/preview tiles (≤1080px). Default skips them.",
    )
    args = parser.parse_args(argv)

    share_url = extract_url(args.url)
    session = new_session()
    parsed = parse_with_backend(
        session,
        share_url,
        args.backend,
        prefer_jpg=args.jpg,
        include_covers=args.include_covers,
    )

    title = parsed.get("title") or "untitled"
    dest = Path(args.output) if args.output else Path("/tmp") / f"share-{sanitize_filename(title)}"
    dest.mkdir(parents=True, exist_ok=True)

    media = collect_media_urls(parsed)
    if not media:
        print(json.dumps({"ok": False, "parsed": parsed}, ensure_ascii=False, indent=2))
        print("No media URLs in parse result.", file=sys.stderr)
        return 2

    if is_xhs_url(share_url):
        referer = "https://www.xiaohongshu.com/"
    elif is_douyin_url(share_url) or parsed.get("backend") == "douyin":
        referer = "https://www.douyin.com/"
    else:
        referer = f"{KUKU_BASE}/"
    results = []
    for i, (kind, media_url) in enumerate(media, 1):
        info = download_one(session, media_url, dest, i, kind, referer)
        results.append(info)
        dim = f"{info['width']}x{info['height']}" if info["width"] else "n/a"
        print(
            f"[{i:02d}] {info['kind']:5s} {info['bytes']:>10,} bytes  {dim:12s}  "
            f"{info['magic']:6s}  {info['path']}"
        )

    summary = {
        "ok": True,
        "backend": parsed.get("backend"),
        "title": title,
        "canonical": parsed.get("canonical"),
        "count": len(results),
        "output": str(dest),
        "largest_bytes": max(r["bytes"] for r in results),
        "skipped_covers": parsed.get("skipped_covers") or 0,
        "files": results,
    }
    (dest / "manifest.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nTitle : {title}")
    print(f"Backend: {parsed.get('backend')}")
    print(f"Saved : {len(results)} file(s) → {dest}")
    skipped = summary["skipped_covers"]
    if skipped:
        print(f"Skipped covers/thumbs: {skipped} (pass --include-covers to keep them)")
    print(f"Largest: {summary['largest_bytes']:,} bytes ({summary['largest_bytes'] / 1048576:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
