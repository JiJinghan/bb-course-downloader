import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('bbhost',Path(__file__).parents[1]/'native/host.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HostTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.base=Path(self.tmp.name).resolve()
        self.course=self.base/'ENG2001'
        self.course.mkdir()
        self.host=module.Host(self.base/'state')
        self.root=self.host.register_root(self.course)['rootId']
        self.item={'id':'_17806_1:12781425_1','name':'Week7S2(1).pptx','folders':['W7','S2'],'courseId':'_17806_1'}

    def tearDown(self):
        self.tmp.cleanup()

    def preview(self,item=None):
        return self.host.preview({'rootId':self.root,'items':[item or self.item]})['items'][0]

    def staged(self,item=None,data=b'PK\x03\x04synthetic-test-document'):
        item=item or self.item
        task=self.host.prepare({'rootId':self.root,'item':item})
        source=self.base/'downloads'/task['staging']
        source.parent.mkdir(parents=True)
        source.write_bytes(data)
        return {'token':task['token'],'source':str(source)}

    def test_existing_manual_file_requires_review(self):
        path=self.course/'W7/S2'
        path.mkdir(parents=True)
        (path/self.item['name']).write_bytes(b'local annotated content')
        self.assertEqual(self.preview()['status'],'review')

    def test_history_survives_rename_edit_and_move(self):
        result=self.host.finalize(self.staged())
        original=self.course/result['savedPath']
        renamed=self.course/'我的笔记.pptx'
        original.rename(renamed)
        renamed.write_bytes(b'edited notes')
        self.assertEqual(self.preview()['status'],'history')
        self.assertFalse(self.preview()['exists'])
        new={**self.item,'id':'_17806_1:999_1','name':'new file.pptx'}
        self.assertEqual(self.preview(new)['status'],'new')

    def test_no_overwrite_and_idempotent_finalization(self):
        path=self.course/'W7/S2'
        path.mkdir(parents=True)
        original=path/self.item['name']
        original.write_bytes(b'user annotations')
        message=self.staged()
        first=self.host.finalize(message)
        second=self.host.finalize(message)
        self.assertEqual(first,second)
        self.assertEqual(original.read_bytes(),b'user annotations')
        self.assertIn('重新下载',first['savedPath'])
        self.assertFalse(Path(message['source']).exists())

    def test_path_traversal_and_unregistered_roots(self):
        with self.assertRaises(ValueError):
            self.host.prepare({'rootId':self.root,'item':{**self.item,'folders':['..']}})
        with self.assertRaises(ValueError):
            self.host.prepare({'rootId':'unregistered','item':self.item})

    def test_symlink_escape_is_refused(self):
        outside=self.base/'outside'
        outside.mkdir()
        (self.course/'W7').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(ValueError):
            self.host.finalize(self.staged())
        self.assertEqual(list(outside.iterdir()),[])

    def test_login_html_and_incomplete_file_not_recorded(self):
        for data in (b'',b'<html><form>login<input type="password"></form></html>'):
            with self.assertRaises(ValueError):
                self.host.finalize(self.staged(data=data))
        self.assertEqual(self.preview()['status'],'new')

    def test_foreign_source_refused(self):
        message=self.staged()
        source=self.base/'private.pptx'
        source.write_bytes(b'PK\x03\x04private')
        with self.assertRaises(ValueError):
            self.host.finalize({**message,'source':str(source)})
        self.assertTrue(source.exists())

    def test_corrupt_history_fails_closed(self):
        (self.host.metadata(self.course)/'history.json').write_text('broken')
        with self.assertRaises(ValueError):
            self.preview()

    def test_manual_confirmation_is_persisted(self):
        self.host.remember({'rootId':self.root,'items':[self.item]})
        again=module.Host(self.base/'state')
        result=again.preview({'rootId':self.root,'items':[self.item]})
        self.assertEqual(result['items'][0]['status'],'history')

    def test_size_mismatch_keeps_staging_and_history_empty(self):
        message=self.staged(item={**self.item,'size':999})
        with self.assertRaises(ValueError):self.host.finalize(message)
        self.assertTrue(Path(message['source']).exists())
        self.assertEqual(self.preview()['status'],'new')

if __name__=='__main__':unittest.main()
