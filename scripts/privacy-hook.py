#!/usr/bin/env python3
"""Block commits or pushes containing private source or historical secrets."""
import importlib.util
import pathlib
import re
import shutil
import subprocess
import sys


def main():
    guard_path = pathlib.Path(__file__).with_name('check-public-source.py')
    spec = importlib.util.spec_from_file_location('privacy_guard', guard_path)
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    if sys.argv[1] == 'pre-commit':
        return guard.main(['--staged'])
    root = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    revisions = set()
    for line in sys.stdin:
        fields = line.split()
        if len(fields) != 4 or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', fields[1]):
            print('Cannot verify push references. Push blocked.', file=sys.stderr)
            return 1
        if set(fields[1]) != {'0'}:
            revisions.add(fields[1])
    if not revisions:
        return 0
    scanner = shutil.which('gitleaks')
    local_scanner = root / '.local/tools/gitleaks/gitleaks'
    if not scanner and local_scanner.is_file():
        scanner = str(local_scanner)
    if not scanner:
        print('Gitleaks is required before pushing. Install it, then retry.', file=sys.stderr)
        return 1
    for revision in sorted(revisions):
        if guard.main(['--history', revision]):
            return 1
        scan = subprocess.run([scanner, 'git', str(root), '--redact', '--no-banner',
                               '--log-opts=' + revision], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if scan.returncode:
            print('The history secret scan failed. Push blocked. Review with Gitleaks locally using --redact.',
                  file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
