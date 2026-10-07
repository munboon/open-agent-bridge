#!/usr/bin/env python3
"""Check tracked source without printing potentially private matching text."""
import ipaddress
import argparse
import pathlib
import re
import subprocess
import sys


PRIVATE_DIRECTORIES = {'.local', '.planning', '.private', '.impeccable', 'node_modules', '.next', 'deploy'}
PRIVATE_DOCUMENTS = {
    'docs/PROJECT-STATUS.md', 'docs/RELEASE-READINESS.md',
    'docs/DEPENDENCY-REVIEW.md', 'docs/CONTACT-TIMING-HANDOFF.md',
    'docs/TRANSPORT-HANDOFF.md', 'docs/LAUNCH.md',
}
TEXT_RULES = {
    'operator record': re.compile(r'(?i)owner (?:authorized|confirmed|selected|decision)|approval[ ]received'),
    'chat export marker': re.compile(r'<(?:send_user_message_question_reply|external_codex_apps|app-context|environment_context)[\s>]'),
    'installation path': re.compile(r'(?i)/(?:home|Users)/[^\s/"`]+/(?:Projects|Documents|Desktop)/|[A-Z]:\\(?:Lab|Nexlink|Users)\\'),
    'lab node identifier': re.compile(r'(?i)\b(?:pve|ct)\d{2,4}\b|\bpve[12]\b'),
}
IPV4 = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')
EXAMPLE_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    '127.0.0.0/8', '192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24',
))
# Exact fixtures exercise private-LAN boundaries and remote-origin rejection.
# Do not exempt entire test files from checking.
TEST_ADDRESSES = {
    'tests/owner-auth.test.ts': {
        '10.0.0.2', '172.16.0.2', '172.31.255.254', '192.168.50.10',
        '172.15.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8', '192.168.1.1',
    },
    'tests/quiet-session.test.ts': {'192.168.50.10', '8.8.8.8'},
}
TEST_ADDRESSES['scripts/check-public-source.py'] = set().union(*TEST_ADDRESSES.values())


def check_file(name, data):
    """Return file, line and reason only; never return matching values."""
    path = pathlib.PurePosixPath(name)
    findings = []
    private_path = (
        bool(set(path.parts) & PRIVATE_DIRECTORIES)
        or name in PRIVATE_DOCUMENTS
        or name.startswith(('docs/development/', 'docs/design/'))
        or (path.name.startswith('.env') and name != '.env.example')
        or path.suffix.lower() in {'.dump', '.sqlite', '.sqlite3', '.db', '.log', '.zip',
                                   '.tar', '.tgz', '.gz', '.7z', '.bundle', '.pem', '.key', '.p12', '.pfx'}
        or path.name in {'bridge.config.json', 'control.json', 'fixture.json'}
    )
    if private_path:
        findings.append((name, 0, 'private file'))
    if b'\0' in data[:8000]:
        return findings
    for number, line in enumerate(data.decode('utf-8', errors='replace').splitlines(), 1):
        for reason, pattern in TEXT_RULES.items():
            if pattern.search(line):
                findings.append((name, number, reason))
        for match in IPV4.finditer(line):
            try:
                address = ipaddress.ip_address(match.group())
            except ValueError:
                continue
            if address.is_unspecified or any(address in network for network in EXAMPLE_NETWORKS):
                continue
            if str(address) in TEST_ADDRESSES.get(name, set()):
                continue
            findings.append((name, number, 'non-example IP address'))
    return findings


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.PIPE)


def check_entries(root, entries, cache):
    findings = []
    for mode, blob, name in entries:
        if mode not in {'100644', '100755'}:
            findings.append((name, 0, 'tracked link or submodule needs review'))
            continue
        if blob not in cache:
            cache[blob] = git(root, 'cat-file', 'blob', blob)
        findings.extend(check_file(name, cache[blob]))
    return findings


def staged_entries(root):
    entries = []
    for record in filter(None, git(root, 'ls-files', '--stage', '-z').split(b'\0')):
        metadata, name = record.split(b'\t', 1)
        mode, blob, stage = metadata.decode().split()
        if stage != '0':
            raise ValueError('Resolve the staged merge conflict before publishing.')
        entries.append((mode, blob, name.decode('utf-8', errors='replace')))
    return entries


def check_history(root, revision):
    # Inspect every unique path/blob pair. A permitted fixture path must not
    # exempt the same content committed under a different path.
    revision = git(root, 'rev-parse', '--verify', revision + '^{commit}').decode().strip()
    trees = set(git(root, 'log', '--format=%T', revision).decode().splitlines())
    entries = set()
    for tree in trees:
        for record in filter(None, git(root, 'ls-tree', '-r', '-z', tree).split(b'\0')):
            metadata, name = record.split(b'\t', 1)
            mode, kind, blob = metadata.decode().split()
            entries.add((mode, blob, name.decode('utf-8', errors='replace')))
    return check_entries(root, sorted(entries), {})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--staged', action='store_true', help='Inspect the index, including staged additions.')
    mode.add_argument('--history', metavar='REVISION', help='Inspect all files reachable from this commit.')
    args = parser.parse_args(argv)
    root = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    if args.staged or args.history:
        try:
            findings = (check_history(root, args.history) if args.history
                        else check_entries(root, staged_entries(root), {}))
        except (subprocess.CalledProcessError, ValueError):
            print('Cannot verify the Git index or history. Publishing is blocked.', file=sys.stderr)
            return 1
        return report(findings, 'Git history' if args.history else 'Git index')
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    findings = []
    count = 0
    for name in filter(None, names):
        file = root / name
        if file.is_symlink():
            findings.append((name, 0, 'tracked symbolic link needs review'))
        elif not file.is_file():
            findings.append((name, 0, 'tracked file missing'))
        else:
            findings.extend(check_file(name, file.read_bytes()))
        count += 1
    return report(findings, f'{count} tracked files')


def report(findings, scope):
    for name, line, reason in sorted(set(findings)):
        print(f'{name}:{line}: {reason}', file=sys.stderr)
    if findings:
        print('Public source privacy check failed. Review locally; do not publish matching text.', file=sys.stderr)
        return 1
    print(f'Public source privacy check passed for {scope}. Review images and prose separately.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
