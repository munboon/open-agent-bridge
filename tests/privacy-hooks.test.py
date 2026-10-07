import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest


SCRIPTS = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
spec = importlib.util.spec_from_file_location('guard', SCRIPTS / 'check-public-source.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class PrivacyHooksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Example contributor')
        self.git('config', 'user.email', 'contributor@example.invalid')
        self.write('README.md', b'Example source.\n')
        self.git('add', 'README.md')
        self.git('commit', '-qm', 'Add example source')

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.PIPE)

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def run_script(self, name, *args, **kwargs):
        return subprocess.run([sys.executable, str(SCRIPTS / name), *args], cwd=self.root,
                              capture_output=True, **kwargs)

    def test_staged_content_is_checked_even_after_worktree_is_cleaned(self):
        value = b'owner ' + b'authorized this operation\n'
        self.write('README.md', value)
        self.git('add', 'README.md')
        self.write('README.md', b'Example source.\n')
        result = self.run_script('check-public-source.py', '--staged')
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(value.strip(), result.stderr)

    def test_unstaged_changes_are_not_treated_as_staged(self):
        self.write('README.md', b'owner ' + b'authorized this operation\n')
        self.assertEqual(self.run_script('check-public-source.py', '--staged').returncode, 0)

    def test_deleted_private_file_still_blocks_history(self):
        self.write('.env.production', b'EXAMPLE=value\n')
        self.git('add', '.env.production')
        self.git('commit', '-qm', 'Add fixture')
        self.git('rm', '-q', '.env.production')
        self.git('commit', '-qm', 'Remove fixture')
        self.assertEqual(self.run_script('check-public-source.py').returncode, 0)
        self.assertEqual(self.run_script('check-public-source.py', '--history', 'HEAD').returncode, 1)

    def test_fixture_content_is_not_exempt_under_other_paths(self):
        data = b'Example fixture: 10.0.0.' + b'2\n'
        self.write('tests/owner-auth.test.ts', data)
        self.git('add', 'tests/owner-auth.test.ts')
        self.git('commit', '-qm', 'Add fixture')
        self.write('docs/guide.md', data)
        self.git('add', 'docs/guide.md')
        self.git('commit', '-qm', 'Copy fixture')
        self.assertEqual(self.run_script('check-public-source.py', '--history', 'HEAD').returncode, 1)

    def test_secret_scanner_failure_blocks_push_without_echoing_output(self):
        bin_path = self.root / 'bin'
        bin_path.mkdir()
        scanner = bin_path / 'gitleaks'
        scanner.write_text('#!/bin/sh\nprintf "private test diagnostic" >&2\nexit 1\n')
        scanner.chmod(0o755)
        revision = self.git('rev-parse', 'HEAD').strip()
        references = b'refs/heads/main ' + revision + b' refs/heads/main ' + b'0' * 40 + b'\n'
        environment = {**os.environ, 'PATH': str(bin_path) + os.pathsep + os.environ['PATH']}
        result = self.run_script('privacy-hook.py', 'pre-push', input=references, env=environment)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(b'private test diagnostic', result.stderr)

    def test_branch_deletion_needs_no_content_scan(self):
        references = b'(delete) ' + b'0' * 40 + b' refs/heads/old ' + b'1' * 40 + b'\n'
        self.assertEqual(self.run_script('privacy-hook.py', 'pre-push', input=references).returncode, 0)

    def test_existing_hook_is_preserved(self):
        hook = self.root / '.git/hooks/pre-commit'
        original = '#!/bin/sh\nexit 0\n'
        hook.write_text(original)
        result = self.run_script('install-privacy-hooks.py')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(hook.read_text(), original)
        self.assertFalse((self.root / '.git/hooks/pre-push').exists())

    def test_installed_hook_blocks_commit_and_preserves_index(self):
        self.assertEqual(self.run_script('install-privacy-hooks.py').returncode, 0)
        self.write('.env.production', b'EXAMPLE=value\n')
        self.git('add', '.env.production')
        result = subprocess.run(['git', 'commit', '-qm', 'Add fixture'], cwd=self.root, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'.env.production', self.git('diff', '--cached', '--name-only'))


if __name__ == '__main__':
    unittest.main()
