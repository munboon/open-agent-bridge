#!/usr/bin/env python3
"""Install local privacy hooks without replacing existing custom hooks."""
import pathlib
import shutil
import subprocess
import sys


MARKER = '# Open Agent Bridge privacy hook\n'


def main():
    root = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    configured = subprocess.run(['git', 'config', '--get', 'core.hooksPath'], capture_output=True, text=True)
    if configured.returncode == 0:
        print('A custom hooks directory is configured. Integrate the privacy hooks there manually.', file=sys.stderr)
        return 1
    hooks = pathlib.Path(subprocess.check_output(['git', 'rev-parse', '--git-path', 'hooks'], text=True).strip())
    if not hooks.is_absolute():
        hooks = root / hooks
    if hooks.is_symlink() or (hooks / 'privacy').is_symlink():
        print('Hooks directory contains a symbolic link. Review it before installing.', file=sys.stderr)
        return 1
    for name in ['pre-commit', 'pre-push']:
        target = hooks / name
        if target.is_symlink() or (target.exists() and MARKER not in target.read_text()):
            print(f'Existing {name} hook preserved. Integrate the privacy hook manually.', file=sys.stderr)
            return 1
    support = hooks / 'privacy'
    support.mkdir(parents=True, exist_ok=True)
    # Copy the guard so switching to an older branch cannot disable it.
    source = pathlib.Path(__file__).resolve().parent
    for name in ['check-public-source.py', 'privacy-hook.py']:
        shutil.copyfile(source / name, support / name)
    for name in ['pre-commit', 'pre-push']:
        target = hooks / name
        target.write_text('#!/bin/sh\n' + MARKER +
                          'exec python3 "$(dirname -- "$0")/privacy/privacy-hook.py" ' + name + ' "$@"\n')
        target.chmod(0o755)
    print('Installed staged-source and pre-push history privacy checks in this checkout.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
