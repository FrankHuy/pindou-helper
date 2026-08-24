#!/usr/bin/env python3
"""Cleanup Xiaohongshu / share-link download caches.

Watchdog for Hermes cron (no_agent=True):
  - empty stdout  => silent (nothing to report)
  - non-empty     => delivered verbatim
  - non-zero exit => error alert

Only deletes directories that match ALL of:
  parent is /tmp
  name starts with xhs- or share-
  not a symlink out of /tmp

Never touches:
  /root/projects/pindou-helper/pics
  Chrome / pip / Hermes sandbox dirs under /tmp
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

TMP = Path("/tmp").resolve()
PREFIXES = ("xhs-", "share-")
MEDIA_EXT = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".gif",
    ".bmp",
    ".bin",
    ".mp4",
    ".mov",
    ".webm",
    ".json",
}


def dir_stats(path: Path) -> tuple[int, int, float]:
    n = 0
    total = 0
    newest = 0.0
    for f in path.rglob("*"):
        if not f.is_file():
            continue
        try:
            st = f.stat()
        except OSError:
            continue
        n += 1
        total += st.st_size
        if st.st_mtime > newest:
            newest = st.st_mtime
    if newest == 0.0:
        try:
            newest = path.stat().st_mtime
        except OSError:
            newest = time.time()
    return n, total, newest


def is_safe_target(path: Path) -> bool:
    if not path.is_dir() or path.is_symlink():
        return False
    try:
        resolved = path.resolve()
    except OSError:
        return False
    if resolved.parent != TMP:
        return False
    name = resolved.name
    return name.startswith(PREFIXES)


def candidates() -> list[Path]:
    if not TMP.is_dir():
        return []
    out = []
    for child in TMP.iterdir():
        if is_safe_target(child):
            out.append(child.resolve())
    return sorted(out, key=lambda p: p.name)


def remove_dir(path: Path, dry_run: bool) -> None:
    if dry_run:
        return
    shutil.rmtree(path)


def fmt_mb(n: int) -> str:
    return f"{n / 1048576:.2f} MB"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--keep-hours", type=float, default=24.0)
    parser.add_argument("--protect-hours", type=float, default=2.0)
    parser.add_argument("--max-mb", type=float, default=500.0)
    args = parser.parse_args(argv)

    now = time.time()
    keep_s = args.keep_hours * 3600
    protect_s = args.protect_hours * 3600
    max_bytes = int(args.max_mb * 1048576)

    rows = []
    for path in candidates():
        n, total, newest = dir_stats(path)
        age_h = (now - newest) / 3600
        rows.append(
            {
                "path": path,
                "n": n,
                "bytes": total,
                "newest": newest,
                "age_h": age_h,
            }
        )

    deleted = []
    remaining = []

    for row in rows:
        empty = row["n"] == 0
        stale = row["age_h"] >= args.keep_hours
        if empty or stale:
            remove_dir(row["path"], args.dry_run)
            deleted.append({**row, "reason": "empty" if empty else f"age>{args.keep_hours:.0f}h"})
        else:
            remaining.append(row)

    remaining.sort(key=lambda r: r["newest"])  # oldest first
    total_left = sum(r["bytes"] for r in remaining)
    if total_left > max_bytes:
        for row in remaining[:]:
            if total_left <= max_bytes:
                break
            if (now - row["newest"]) < protect_s:
                continue
            remove_dir(row["path"], args.dry_run)
            remaining.remove(row)
            total_left -= row["bytes"]
            deleted.append({**row, "reason": f"cap>{args.max_mb:.0f}MB"})

    if not deleted:
        return 0

    freed = sum(r["bytes"] for r in deleted)
    left_n = sum(r["n"] for r in remaining)
    left_b = sum(r["bytes"] for r in remaining)
    prefix = "[dry-run] " if args.dry_run else ""
    lines = [
        f"{prefix}share-download cleanup",
        f"removed {len(deleted)} dir(s), {sum(r['n'] for r in deleted)} file(s), {fmt_mb(freed)}",
        f"kept {len(remaining)} dir(s), {left_n} file(s), {fmt_mb(left_b)}",
    ]
    for row in deleted:
        lines.append(
            f"  - {row['path'].name}  {row['n']} files  {fmt_mb(row['bytes'])}  "
            f"age={row['age_h']:.1f}h  {row['reason']}"
        )
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
