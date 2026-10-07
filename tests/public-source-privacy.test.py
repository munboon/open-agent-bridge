import importlib.util
import pathlib
import unittest


module_path = pathlib.Path(__file__).resolve().parents[1] / 'scripts/check-public-source.py'
spec = importlib.util.spec_from_file_location('public_privacy', module_path)
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class PublicSourcePrivacyTest(unittest.TestCase):
    def test_private_files_fail_even_without_text(self):
        for name in ['.env.production', '.local/report.md', 'docs/PROJECT-STATUS.md',
                     'deploy/release.sh', 'backup.dump', 'bridge.config.json']:
            self.assertTrue(privacy.check_file(name, b''), name)

    def test_examples_and_loopback_pass(self):
        self.assertFalse(privacy.check_file('.env.example', b'HOST=127.0.0.1'))
        self.assertFalse(privacy.check_file('docs/guide.md', b'https://192.0.2.15 https://203.0.113.9'))

    def test_new_addresses_fail_inside_fixture_files(self):
        self.assertFalse(privacy.check_file('tests/owner-auth.test.ts', b'10.0.0.' + b'2'))
        self.assertTrue(privacy.check_file('tests/owner-auth.test.ts', b'10.0.0.' + b'3'))
        self.assertTrue(privacy.check_file('docs/guide.md', b'10.0.0.' + b'2'))

    def test_private_text_is_not_returned_in_diagnostics(self):
        for value in [b'owner ' + b'authorized', b'<' + b'send_user_message_question_reply' + b'>',
                      b'/home/' + b'example-private/Projects/project/']:
            findings = privacy.check_file('docs/guide.md', value)
            self.assertTrue(findings)
            self.assertNotIn(value.decode(), repr(findings))

    def test_binary_content_still_obeys_path_rules(self):
        self.assertTrue(privacy.check_file('backup.db', b'\0binary'))
        self.assertFalse(privacy.check_file('docs/images/example.png', b'\0binary'))


if __name__ == '__main__':
    unittest.main()
