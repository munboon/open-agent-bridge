#!/usr/bin/env python3
"""Finite-lifetime, developer-hosted transfer endpoint. Python standard library only."""

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1"
BLOCK = 64 * 1024
MAX_PART = 96 * 1024 * 1024
MAX_FILE = 10 * 1024 * 1024 * 1024


class TransferError(Exception):
    def __init__(self, code, status=400):
        self.code, self.status = code, status


def fail(code, status=400):
    raise TransferError(code, status)


def safe_path(value, missing_leaf=False):
    """Reject links/reparse ancestors and synced roots before opening any data."""
    target = Path(os.path.abspath(value))
    for item in (target, *target.parents):
        if re.match(r"(?i)^onedrive(?:$|[ -])", item.name):
            fail("synced_path_rejected")
        try:
            info = item.lstat()
        except FileNotFoundError:
            if item == target and missing_leaf:
                continue
            fail("path_missing")
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            fail("linked_path_rejected")
        if item != target and not stat.S_ISDIR(info.st_mode):
            fail("ancestor_not_directory")
    return target


def open_read(value):
    target = safe_path(value)
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(target, flags)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        fail("not_regular_file")
    return os.fdopen(fd, "rb")


def digest_file(value, offset=0, length=None, check=None):
    digest = hashlib.sha256()
    total = 0
    with open_read(value) as source:
        source.seek(offset)
        while length is None or total < length:
            if check:
                check()
            block = source.read(BLOCK if length is None else min(BLOCK, length - total))
            if not block:
                break
            digest.update(block)
            total += len(block)
    return total, digest.hexdigest()


def valid_filename(name):
    return (isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", name)
            and not name.endswith(".") and ".." not in name
            and name.split(".")[0].upper() not in
            {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(10)), *(f"LPT{i}" for i in range(10))})


def load_manifest(value, max_bytes):
    with open_read(value) as source:
        raw = source.read(512 * 1024 + 1)
    if len(raw) > 512 * 1024:
        fail("manifest_too_large")
    def unique_object(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("duplicate_key")
            result[key] = item
        return result
    try:
        manifest = json.loads(raw, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError):
        fail("invalid_manifest")
    keys = {"version", "transfer_id", "mode", "filename", "size", "sha256", "parts"}
    if not isinstance(manifest, dict) or set(manifest) != keys or manifest["version"] != VERSION:
        fail("invalid_manifest_schema")
    if not isinstance(manifest["transfer_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", manifest["transfer_id"]):
        fail("invalid_transfer_id")
    if manifest["mode"] not in ("download", "upload") or not valid_filename(manifest["filename"]):
        fail("invalid_mode_or_filename")
    if type(manifest["size"]) is not int or not 0 <= manifest["size"] <= max_bytes:
        fail("file_size_limit")
    if not isinstance(manifest["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"]):
        fail("invalid_digest")
    if not isinstance(manifest["parts"], list) or not 1 <= len(manifest["parts"]) <= 1024:
        fail("invalid_parts")
    offset = 0
    for index, part in enumerate(manifest["parts"]):
        if not isinstance(part, dict) or set(part) != {"index", "offset", "size", "sha256"}:
            fail("invalid_part_schema")
        if any(type(part[key]) is not int for key in ("index", "offset", "size")):
            fail("invalid_part_schema")
        if part["index"] != index or part["offset"] != offset or not 0 <= part["size"] <= MAX_PART:
            fail("invalid_part_layout")
        if part["size"] == 0 and not (manifest["size"] == 0 and len(manifest["parts"]) == 1):
            fail("invalid_part_layout")
        if not isinstance(part["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", part["sha256"]):
            fail("invalid_part_digest")
        offset += part["size"]
    if offset != manifest["size"]:
        fail("invalid_part_layout")
    return manifest


class Transfer:
    def __init__(self, root, manifest, token, ttl):
        self.root = safe_path(root)
        if not self.root.is_dir():
            fail("root_not_directory")
        if os.name != "nt" and self.root.stat().st_mode & 0o077:
            fail("root_permissions_too_broad")
        self.manifest, self.token = manifest, token
        self.deadline = time.monotonic() + ttl
        self.expires_at = int(time.time() + ttl)
        self.mutex = threading.Lock()
        self.lock_file = None
        self.target = self.root / manifest["filename"]
        self.staging = self.root / (".open-agent-bridge-transfer-" + manifest["transfer_id"])
        self.completed = False
        if manifest["mode"] == "download":
            self.verify_target()
            for part in manifest["parts"]:
                if digest_file(self.target, part["offset"], part["size"], self.ensure_live) != (part["size"], part["sha256"]):
                    fail("source_part_digest_mismatch")
            self.source_identity = self.identity()
            return
        try:
            safe_path(self.staging, missing_leaf=True)
            self.staging.mkdir(mode=0o700, exist_ok=True)
            if os.name != "nt" and self.staging.stat().st_mode & 0o077:
                fail("staging_permissions_too_broad")
            self.acquire_lock()
            self.prepare_resume()
            if self.target.exists() or self.target.is_symlink():
                self.verify_target()
                self.completed = True
            elif shutil.disk_usage(self.root).free < manifest["size"] * 2 + BLOCK:
                fail("insufficient_disk_space")
        except Exception:
            self.close()
            raise

    def ensure_live(self):
        if time.monotonic() >= self.deadline:
            fail("transfer_expired", 410)

    def identity(self):
        info = safe_path(self.target).stat()
        return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns

    def verify_target(self):
        if digest_file(self.target, check=self.ensure_live) != (self.manifest["size"], self.manifest["sha256"]):
            fail("destination_or_source_digest_mismatch", 409)

    def acquire_lock(self):
        lock_path = safe_path(self.staging / ".lock", missing_leaf=True)
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0), 0o600)
        self.lock_file = os.fdopen(fd, "r+b")
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    self.lock_file.write(b"0")
                    self.lock_file.flush()
                self.lock_file.seek(0)
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fail("transfer_already_running", 409)

    def prepare_resume(self):
        record = self.staging / "manifest.json"
        canonical = json.dumps(self.manifest, sort_keys=True, separators=(",", ":")).encode()
        safe_path(record, missing_leaf=True)
        if record.exists():
            with open_read(record) as source:
                if source.read(len(canonical) + 1) != canonical:
                    fail("resume_manifest_conflict", 409)
        else:
            if any(item.name != ".lock" for item in self.staging.iterdir()):
                fail("unrecognized_resume_directory")
            with open(record, "xb") as dest:
                dest.write(canonical)
                dest.flush()
                os.fsync(dest.fileno())
        known = {"manifest.json", ".lock", *(self.part_path(part["index"]).name for part in self.manifest["parts"])}
        for item in self.staging.iterdir():
            safe_path(item)
            if re.fullmatch(r"tmp-[a-f0-9]{32}", item.name):
                if not item.is_file():
                    fail("unexpected_staging_entry")
                item.unlink()  # Only this helper's interrupted temporary files, under its exclusive lock.
            elif item.name not in known or not item.is_file():
                fail("unexpected_staging_entry")
        self.committed_parts()

    def part_path(self, index):
        return self.staging / f"part-{index:04d}.bin"

    def committed_parts(self):
        result = []
        for part in self.manifest["parts"]:
            target = self.part_path(part["index"])
            safe_path(target, missing_leaf=True)
            if target.exists():
                if digest_file(target, check=self.ensure_live) != (part["size"], part["sha256"]):
                    fail("committed_part_corrupt", 409)
                result.append(part["index"])
        return result

    def status(self):
        self.ensure_live()
        return {"version": VERSION, "transfer_id": self.manifest["transfer_id"], "mode": self.manifest["mode"],
                "expires_at": self.expires_at, "verified": self.completed,
                "committed_parts": self.committed_parts() if self.manifest["mode"] == "upload" else [],
                "size": self.manifest["size"], "sha256": self.manifest["sha256"]}

    def temporary(self):
        safe_path(self.staging)
        temp = self.staging / ("tmp-" + secrets.token_hex(16))
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0), 0o600)
        return temp, os.fdopen(fd, "wb")

    def publish(self, temp, target):
        self.ensure_live()
        safe_path(temp)
        safe_path(target, missing_leaf=True)
        # Same-volume hard-link publication is atomic and cannot overwrite an
        # existing name. os.rename would overwrite on POSIX. NTFS/ext4 supported.
        try:
            os.link(temp, target, follow_symlinks=False)
        except FileExistsError:
            fail("overwrite_rejected", 409)
        temp.unlink()

    def upload(self, index, body, length):
        self.ensure_live()
        if self.completed:
            fail("transfer_already_verified", 409)
        part = self.manifest["parts"][index]
        if length > part["size"]:
            fail("part_too_large", 413)
        if length != part["size"]:
            fail("part_length_mismatch", 422)
        target = self.part_path(index)
        safe_path(target, missing_leaf=True)
        existing = target.exists()
        if existing and digest_file(target, check=self.ensure_live) != (part["size"], part["sha256"]):
            fail("committed_part_corrupt", 409)
        if shutil.disk_usage(self.root).free < length + BLOCK:
            fail("insufficient_disk_space", 507)
        temp, output = self.temporary()
        digest, remaining = hashlib.sha256(), length
        try:
            with output:
                while remaining:
                    self.ensure_live()
                    block = body.read(min(BLOCK, remaining))
                    if not block:
                        fail("incomplete_body", 422)
                    output.write(block)
                    digest.update(block)
                    remaining -= len(block)
                output.flush()
                os.fsync(output.fileno())
            self.ensure_live()
            if digest.hexdigest() != part["sha256"]:
                fail("part_conflict" if existing else "part_digest_mismatch", 409 if existing else 422)
            if not existing:
                self.publish(temp, target)
            return {"index": index, "size": length, "sha256": digest.hexdigest(), "duplicate": existing}
        finally:
            if temp.exists():
                temp.unlink()

    def finalize(self):
        self.ensure_live()
        if self.completed:
            self.verify_target()
            return self.status()
        if len(self.committed_parts()) != len(self.manifest["parts"]):
            fail("parts_missing", 409)
        if shutil.disk_usage(self.root).free < self.manifest["size"] + BLOCK:
            fail("insufficient_disk_space", 507)
        temp, output = self.temporary()
        digest, size = hashlib.sha256(), 0
        try:
            with output:
                for part in self.manifest["parts"]:
                    with open_read(self.part_path(part["index"])) as source:
                        while True:
                            self.ensure_live()
                            block = source.read(BLOCK)
                            if not block:
                                break
                            digest.update(block)
                            size += len(block)
                            if size > self.manifest["size"]:
                                fail("assembly_too_large", 413)
                            output.write(block)
                output.flush()
                os.fsync(output.fileno())
            if (size, digest.hexdigest()) != (self.manifest["size"], self.manifest["sha256"]):
                fail("whole_file_digest_mismatch", 422)
            self.publish(temp, self.target)
            self.completed = True
            return self.status()
        finally:
            if temp.exists():
                temp.unlink()

    def close(self):
        if self.lock_file:
            self.lock_file.close()
            self.lock_file = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OpenTransfer/1"
    sys_version = ""

    def log_message(self, *args):
        pass  # Never log request paths, authorization headers or body contents.

    def send_json(self, status, payload):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection = True

    def send_error(self, code, message=None, explain=None):
        self.send_json(code, {"error": "invalid_http_request"})

    def handle_expect_100(self):
        self.send_json(417, {"error": "expect_not_supported"})
        return False

    def dispatch(self):
        try:
            transfer = self.server.transfer
            transfer.ensure_live()
            auth = self.headers.get_all("Authorization", [])
            expected = "Bearer " + transfer.token
            if len(auth) != 1 or not hmac.compare_digest(auth[0].encode("utf-8"), expected.encode("ascii")):
                fail("unauthorized", 401)
            if len(self.path) > 160 or any(char in self.path for char in ("%", "\\", "?", "#")) or ".." in self.path:
                fail("invalid_path", 400)
            if self.headers.get_all("Transfer-Encoding"):
                fail("transfer_encoding_not_supported", 400)
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) > 1 or (lengths and not re.fullmatch(r"[0-9]{1,12}", lengths[0])):
                fail("invalid_content_length", 400)
            length = int(lengths[0]) if lengths else 0
            if self.command != "PUT" and length:
                fail("body_not_allowed", 400)
            if not transfer.mutex.acquire(blocking=False):
                fail("transfer_busy", 409)
            try:
                self.route(transfer, length, bool(lengths))
            finally:
                transfer.mutex.release()
        except TransferError as error:
            if getattr(self, "binary_started", False):
                self.close_connection = True
            else:
                self.send_json(error.status, {"error": error.code})
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            self.close_connection = True
        except Exception:
            if getattr(self, "binary_started", False):
                self.close_connection = True
            else:
                self.send_json(500, {"error": "transfer_io_error"})

    def route(self, transfer, length, has_length):
        match = re.fullmatch(r"/v1/parts/(0|[1-9][0-9]{0,3})", self.path)
        index = int(match[1]) if match else None
        if index is not None and index >= len(transfer.manifest["parts"]):
            fail("not_found", 404)
        if self.command == "GET" and self.path == "/v1/status":
            self.send_json(200, transfer.status())
        elif transfer.manifest["mode"] == "upload" and self.command == "PUT" and index is not None:
            if not has_length:
                fail("content_length_required", 411)
            self.send_json(200, transfer.upload(index, self.rfile, length))
        elif transfer.manifest["mode"] == "upload" and self.command == "POST" and self.path == "/v1/finalize":
            self.send_json(200, transfer.finalize())
        elif transfer.manifest["mode"] == "download" and self.command == "GET" and (self.path == "/v1/file" or index is not None):
            self.download(transfer, index)
        else:
            fail("not_found", 404)

    def download(self, transfer, index):
        if self.headers.get("Range"):
            fail("use_manifest_parts_for_resume", 416)
        if transfer.identity() != transfer.source_identity:
            fail("source_changed", 409)
        part = transfer.manifest if index is None else transfer.manifest["parts"][index]
        transfer.ensure_live()
        with open_read(transfer.target) as source:
            source.seek(0 if index is None else part["offset"])
            self.binary_started = True
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(part["size"]))
            self.send_header("X-Content-SHA256", part["sha256"])
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            remaining = part["size"]
            while remaining:
                transfer.ensure_live()
                block = source.read(min(BLOCK, remaining))
                if not block:
                    self.close_connection = True
                    return
                self.wfile.write(block)
                remaining -= len(block)
        self.close_connection = True

    do_GET = do_PUT = do_POST = dispatch


class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False
    request_queue_size = 4

    def __init__(self, address, transfer):
        self.transfer = transfer
        self.slots = threading.BoundedSemaphore(4)
        self.active = set()
        self.active_lock = threading.Lock()
        super().__init__(address, Handler)

    def process_request(self, request, address):
        request.settimeout(min(10, max(0.1, self.transfer.deadline - time.monotonic())))
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        with self.active_lock:
            self.active.add(request)
        try:
            super().process_request(request, address)
        except Exception:
            with self.active_lock:
                self.active.discard(request)
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            with self.active_lock:
                self.active.discard(request)
            self.slots.release()

    def handle_error(self, request, address):
        pass

    def close_connections(self):
        with self.active_lock:
            for request in self.active:
                try:
                    request.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                request.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--ttl", type=int, default=1800)
    parser.add_argument("--max-bytes", type=int, default=1024 * 1024 * 1024)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or not 1 <= args.ttl <= 1800 or not 0 <= args.max_bytes <= MAX_FILE:
        fail("invalid_limits")
    token = os.environ.pop("OPEN_AGENT_BRIDGE_TRANSFER_TOKEN", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", token):
        fail("invalid_transfer_token")
    manifest = load_manifest(args.manifest, args.max_bytes)
    transfer = Transfer(args.root, manifest, token, args.ttl)
    server = None
    stopped = threading.Event()
    try:
        transfer.ensure_live()
        server = Server(("127.0.0.1", args.port), transfer)

        def deadline():
            if not stopped.wait(max(0, transfer.deadline - time.monotonic())):
                server.close_connections()
                server.shutdown()

        watcher = threading.Thread(target=deadline, daemon=True)
        watcher.start()
        print(json.dumps({"event": "ready", "version": VERSION, "host": "127.0.0.1", "port": server.server_port,
                          "transfer_id": manifest["transfer_id"], "mode": manifest["mode"], "expires_at": transfer.expires_at}), flush=True)
        try:
            server.serve_forever(poll_interval=0.1)
        except KeyboardInterrupt:
            pass
    finally:
        stopped.set()
        if server:
            server.close_connections()
            server.server_close()
        transfer.close()


if __name__ == "__main__":
    try:
        main()
    except TransferError as error:
        print(json.dumps({"event": "error", "code": error.code}), flush=True)
        sys.exit(1)
    except Exception:
        print(json.dumps({"event": "error", "code": "helper_start_failed"}), flush=True)
        sys.exit(1)
