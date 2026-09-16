"""Session-owned tunnel supervisor. Exit on parent stdin EOF or bounded TTL."""
import os
import signal
import subprocess
import sys
import threading
import time


def main():
    stop = threading.Event()
    threading.Thread(target=lambda: (sys.stdin.buffer.read(), stop.set()), daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    child = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    deadline = time.monotonic() + 900
    try:
        while child.poll() is None and time.monotonic() < deadline and not stop.wait(0.25):
            pass
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)


if __name__ == '__main__':
    main()
