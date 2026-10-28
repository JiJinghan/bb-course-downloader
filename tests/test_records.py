import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'native'))
from host import Host

class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.course = self.base / 'MAT1001'
        self.course.mkdir()
        self.host = Host(self.base / 'state')
        self.root = self.host.register_root(self.course)['rootId']
        self.item = {'id': '_mat:1_1', 'name': 'notes.pdf', 'courseId': '_mat',
                     'folders': ['Lecture Notes', 'Week1-1, Lecture 1'],
                     'url': 'https://bb.cuhk.edu.cn/bbcswebdav/xid-1_1', 'choice': 'download'}
        self.node = {'id': '_mat|lecture/1', 'path': ['Lecture Notes', 'Week1-1, Lecture 1'],
                     'title': 'Week1-1, Lecture 1', 'kind': 'item', 'fileIds': [self.item['id']],
                     'links': [{'title': 'A [proof] <script>', 'url': 'https://example.org/a(b)?x=1&y=2'}],
                     'url': 'https://bb.cuhk.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_mat'}
        self.request = {'action': 'write_records', 'rootId': self.root, 'course': {'id': '_mat', 'title': 'MAT1001'},
                        'scope': {'week': None}, 'scanId': 'scan1', 'scannedAt': '2026-10-27T12:00:00Z',
                        'nodes': [self.node], 'items': [self.item], 'warnings': []}

    def tearDown(self):
        self.temp.cleanup()

    def run_records(self, **changes):
        return self.host.handle({**self.request, **changes})

    def test_records_have_hierarchy_teacher_urls_and_no_false_download_success(self):
        result = self.run_records()
        index = (self.course / result['indexPath']).read_text()
        self.assertIn('Lecture Notes / Week1-1, Lecture 1', index)
        self.assertIn('未下载', index)
        self.assertNotIn('<script>', index)
        self.assertIn('https://example.org/a%28b%29?x=1&y=2', index)
        links = self.course / '/'.join(self.node['path']) / '链接.md'
        self.assertTrue(links.is_file())
        self.assertFalse((links.parent / 'notes.pdf').exists())

    def test_user_edited_generated_record_is_backed_up_once(self):
        self.run_records()
        path = self.course / '课程目录.md'
        user_content = path.read_text() + '\n我的课程笔记\n'
        path.write_text(user_content)
        result = self.run_records(scanId='scan2')
        self.assertEqual(len(result['backups']), 1)
        self.assertEqual((self.course / result['backups'][0]).read_text(), user_content)
        self.assertEqual(self.run_records(scanId='scan2')['backups'], [])

    def test_untracked_name_collision_never_overwrites_ordinary_file(self):
        path = self.course / '课程目录.md'
        path.write_text('这是我自己的笔记')
        result = self.run_records()
        self.assertNotEqual(result['indexPath'], path.name)
        self.assertEqual(path.read_text(), '这是我自己的笔记')
        self.assertEqual(result['backups'], [])
        self.assertEqual(self.run_records()['indexPath'], result['indexPath'])

    def test_text_only_item_has_no_empty_directory_and_partial_scan_retains_previous(self):
        text_node = {**self.node, 'id': 'plain', 'path': ['Lecture Notes', '文字说明'], 'fileIds': [], 'links': []}
        self.run_records(nodes=[text_node])
        self.assertFalse((self.course / 'Lecture Notes/文字说明').exists())
        result = self.run_records(scanId='scan2')
        index = (self.course / result['indexPath']).read_text()
        self.assertIn('文字说明', index)
        self.assertIn('无附件或链接', index)
        self.assertIn('此前扫描', index)

    def test_shared_file_references_existing_location_without_copying(self):
        saved = self.course / '我的整理' / '已批注.pdf'
        saved.parent.mkdir()
        saved.write_bytes(b'%PDF-1.7 original user file')
        self.host.remember({'rootId': self.root, 'items': [{**self.item, 'candidatePath': '我的整理/已批注.pdf'}]})
        second = {**self.node, 'id': 'midterm/review', 'path': ['Midterm', 'Review'], 'links': []}
        self.run_records(nodes=[self.node, second])
        self.assertEqual(len(list(self.course.rglob('*.pdf'))), 1)
        reference = (self.course / 'Midterm/Review/附件位置.md').read_text()
        self.assertIn('%E6%88%91', reference)
        self.assertIn('已下载', reference)
        saved.rename(saved.with_name('更名.pdf'))
        self.run_records(nodes=[self.node, second])
        self.assertIn('原路径已变动', (self.course / '课程目录.md').read_text())

    def test_removed_links_refresh_the_managed_file(self):
        self.run_records()
        self.run_records(nodes=[{**self.node, 'links': []}])
        content = (self.course / 'Lecture Notes/Week1-1, Lecture 1/链接.md').read_text()
        self.assertIn('未发现', content)
        self.assertNotIn('example.org', content)

    def test_traversal_symlink_and_bad_links_are_refused(self):
        with self.assertRaises(ValueError):
            self.run_records(nodes=[{**self.node, 'path': ['..', 'escape']}])
        with self.assertRaises(ValueError):
            self.run_records(nodes=[{**self.node, 'links': [{'title': 'bad', 'url': 'javascript:alert(1)'}]}])
        outside = self.base / 'outside'
        outside.mkdir()
        (self.course / 'Lecture Notes').symlink_to(outside)
        with self.assertRaises(ValueError):
            self.run_records()
        self.assertEqual(list(outside.iterdir()), [])

    def test_corrupt_catalog_is_not_silently_replaced(self):
        self.run_records()
        (self.course / '.bb-downloads/catalog.json').write_text('broken')
        with self.assertRaises(ValueError):
            self.run_records()
        self.assertEqual((self.course / '.bb-downloads/catalog.json').read_text(), 'broken')

if __name__ == '__main__':
    unittest.main()
