"""Read-only ZIP preflight. Never extracts or executes release content."""
import argparse
import hashlib
import json
import ntpath
import re
import stat
import tempfile
import zipfile
from pathlib import Path


def check_archive(source, expected_sha256, max_bytes=1073741824):
    source = Path(source)
    if source.is_symlink() or not source.is_file():
        raise ValueError("invalid_source")
    # Hash and inspect the same private snapshot. Replacing or modifying the
    # original during inspection cannot switch the bytes being approved.
    with tempfile.TemporaryFile(mode="w+b") as snapshot:
        digest = hashlib.sha256()
        copied = 0
        with source.open("rb") as handle:
            for block in iter(lambda: handle.read(1048576), b""):
                copied += len(block)
                if copied > 10737418240:
                    raise ValueError("archive_source_limit")
                digest.update(block)
                snapshot.write(block)
        if digest.hexdigest() != expected_sha256:
            raise ValueError("digest_mismatch")
        snapshot.seek(0)
        return inspect_snapshot(snapshot, expected_sha256, max_bytes)


def inspect_snapshot(snapshot, expected_sha256, max_bytes):
    total = 0
    names = set()
    with zipfile.ZipFile(snapshot) as archive:
        entries = archive.infolist()
        if len(entries) > 10000:
            raise ValueError("too_many_entries")
        for entry in entries:
            name = entry.filename
            normalized = name.replace("\\", "/")
            parts = normalized.rstrip("/").split("/")
            if (not name or "\\" in name or "\x00" in name or normalized.startswith("/")
                    or ntpath.splitdrive(name)[0] or any(part in ("", ".", "..") for part in parts)
                    or any(part.endswith((".", " ")) or ":" in part for part in parts)
                    or any(re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", part, re.I) for part in parts)):
                raise ValueError("unsafe_archive_path")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError("unsafe_archive_entry")
            folded = normalized.rstrip("/").casefold()
            if folded in names:
                raise ValueError("duplicate_archive_path")
            names.add(folded)
            total += entry.file_size
            if total > max_bytes or entry.flag_bits & 1:
                raise ValueError("archive_limit_or_encrypted_zip")
        files = {entry.filename.casefold() for entry in entries if not entry.is_dir()}
        for name in names:
            parts = name.split("/")
            if any("/".join(parts[:index]) in files for index in range(1, len(parts))):
                raise ValueError("archive_path_conflict")
        if archive.testzip() is not None:
            raise ValueError("archive_crc_failure")
    return {"safe_to_stage": True, "sha256": expected_sha256, "entries": len(entries), "expanded_bytes": total}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--max-bytes", type=int, default=1073741824)
    args = parser.parse_args()
    try:
        if not re.fullmatch(r"[0-9a-f]{64}", args.sha256) or not 0 < args.max_bytes <= 10737418240:
            raise ValueError("invalid_limits")
        print(json.dumps(check_archive(args.archive, args.sha256, args.max_bytes)))
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError):
        print(json.dumps({"safe_to_stage": False, "error": "archive_verification_failed"}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
