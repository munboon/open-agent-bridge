#!/usr/bin/env python3
"""Check tracked source without printing potentially private matching text."""
import ipaddress
import pathlib
import re
import subprocess
import sys


PRIVATE_DIRECTORIES = {'.local', '.planning', 'node_modules', '.next', 'deploy'}
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
        or path.suffix.lower() in {'.dump', '.sqlite', '.sqlite3', '.db', '.log', '.zip'}
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


def main():
    root = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
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
    for name, line, reason in findings:
        print(f'{name}:{line}: {reason}', file=sys.stderr)
    if findings:
        print('Public source privacy check failed. Review locally; do not publish matching text.', file=sys.stderr)
        return 1
    print(f'Public source privacy check passed for {count} tracked files. Review images, history and prose separately.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
