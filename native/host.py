#!/usr/bin/env python3
"""BB Course Downloader native messaging host. No network access or shell execution."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import uuid

HOST_NAME = 'cn.cuhk.bb_downloader'
STATE_DIR = Path.home() / 'Library/Application Support/BB Course Downloader'
MAX_MESSAGE = 8 * 1024 * 1024


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_json(path, default):
    if not path.exists():
        return default
    if path.is_symlink():
        raise ValueError('记录文件不能是符号链接')
    try:
        return json.loads(path.read_text('utf-8'))
    except (ValueError, OSError) as error:
        raise ValueError(f'无法读取记录，请保留文件并人工核实：{path.name}') from error


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temp.open('x', encoding='utf-8') as out:
        os.chmod(temp, 0o600)
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)


def component(value):
    value = str(value).strip()
    if not value or value in ('.', '..') or value.startswith('.') or re.search(r'[/\\\x00-\x1f]', value):
        raise ValueError('无效的文件名或目录名')
    if len(value.encode('utf-8')) > 240:
        raise ValueError('文件名过长')
    return value


class Host:
    def __init__(self, state_dir=STATE_DIR):
        self.state_dir = Path(state_dir)
        self.config_path = self.state_dir / 'config.json'
        self.config = read_json(self.config_path, {'version': 1, 'roots': {}, 'pending': {}, 'receipts': {}})

    def save(self):
        atomic_json(self.config_path, self.config)

    def root(self, token):
        if token not in self.config['roots']:
            raise ValueError('请先选择并授权课程资料目录')
        raw = Path(self.config['roots'][token])
        path = raw.resolve(strict=True)
        if raw.is_symlink() or not path.is_dir():
            raise ValueError('选定目录已移动或不可访问，请重新选择')
        return path

    def metadata(self, root):
        path = root / '.bb-downloads'
        if path.is_symlink():
            raise ValueError('.bb-downloads 不能是符号链接')
        path.mkdir(exist_ok=True)
        return path

    def history(self, root):
        data = read_json(self.metadata(root) / 'history.json', {'version': 1, 'items': {}})
        if data.get('version') != 1 or not isinstance(data.get('items'), dict):
            raise ValueError('下载记录格式不受支持，请人工核实')
        return data

    def write_history(self, root, history):
        atomic_json(self.metadata(root) / 'history.json', history)

    def register_root(self, selected):
        root = Path(selected).resolve(strict=True)
        if not root.is_dir() or root == Path('/') or root == Path.home():
            raise ValueError('请选择具体的课程资料文件夹')
        for token, path in self.config['roots'].items():
            if path == str(root):
                return {'rootId': token, 'path': str(root)}
        token = uuid.uuid4().hex
        self.config['roots'][token] = str(root)
        self.save()
        return {'rootId': token, 'path': str(root)}

    # Document generator uses the same checked JSON persistence as download history.
    read_record = staticmethod(read_json)
    save_record = staticmethod(atomic_json)

    def choose_root(self, message):
        picker = Path(__file__).parent / 'BB Folder Picker.app/Contents/MacOS/folder-picker'
        if not picker.is_file():
            picker = Path(__file__).with_name('folder-picker')
        if not picker.is_file():
            raise ValueError('目录选择器尚未安装，请运行安装助手.command')
        start = str(Path.home() / 'Desktop')
        if message.get('rootId') in self.config['roots']:
            start = self.config['roots'][message['rootId']]
        result = subprocess.run([str(picker), start], capture_output=True, text=True, timeout=300, check=True)
        selected = result.stdout.strip()
        return self.register_root(selected) if selected else {'cancelled': True}

    def validate_item(self, item):
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or len(item['id']) > 2000:
            raise ValueError('无效的资料标识')
        name = component(item['name'])
        folders = item.get('folders', [])
        if not isinstance(folders, list) or len(folders) > 30:
            raise ValueError('目录层级过深')
        return {'id': item['id'], 'name': name, 'folders': [component(x) for x in folders],
                'size': item.get('size'), 'courseId': str(item.get('courseId', ''))}

    def local_files(self, root):
        result = []
        for parent, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not d.startswith('.') and not (Path(parent) / d).is_symlink()]
            for name in names:
                p = Path(parent) / name
                if name.startswith('.') or p.is_symlink() or not p.is_file() or name.endswith(('.crdownload', '.part')):
                    continue
                result.append({'path': str(p.relative_to(root)), 'name': name, 'size': p.stat().st_size})
                if len(result) > 100000:
                    raise ValueError('目录文件过多，请选择具体课程文件夹')
        return result

    def preview(self, message):
        root = self.root(message['rootId'])
        history = self.history(root)
        files = self.local_files(root)
        by_name = {}
        for f in files:
            by_name.setdefault(f['name'].casefold(), []).append(f)
        result = []
        for raw in message['items']:
            item = self.validate_item(raw)
            old = history['items'].get(item['id'])
            if old:
                old_path = old.get('savedPath')
                exists = bool(old_path and (root / old_path).is_file())
                result.append({'id': item['id'], 'status': 'history', 'exists': exists,
                               'savedPath': old_path, 'recordedAt': old.get('completedAt')})
                continue
            candidates = by_name.get(item['name'].casefold(), [])
            result.append({'id': item['id'], 'status': 'review' if candidates else 'new',
                           'candidates': candidates[:20]})
        return {'items': result, 'localCount': len(files), 'path': str(root)}

    def remember(self, message):
        root = self.root(message['rootId'])
        history = self.history(root)
        for raw in message['items']:
            item = self.validate_item(raw)
            candidate = raw.get('candidatePath')
            if candidate and (not (root / candidate).resolve().is_relative_to(root) or not (root / candidate).is_file()):
                raise ValueError('待核实文件必须在所选课程目录内')
            history['items'][item['id']] = {**item, 'savedPath': candidate,
                                          'completedAt': now(), 'manual': True}
        self.write_history(root, history)
        return {'remembered': len(message['items'])}

    def prepare(self, message):
        self.root(message['rootId'])
        item = self.validate_item(message['item'])
        token = uuid.uuid4().hex
        self.config['pending'][token] = {'rootId': message['rootId'], 'item': item, 'createdAt': now()}
        self.save()
        return {'token': token, 'staging': f'_BB_Downloads/{token}/{item["name"]}'}

    def destination(self, root, item, token):
        parent = root
        for folder in item['folders']:
            parent = parent / folder
            if parent.is_symlink():
                raise ValueError('目标子目录不能是符号链接')
            parent.mkdir(exist_ok=True)
        if not parent.resolve().is_relative_to(root):
            raise ValueError('目标必须在授权目录内')
        name = item['name']
        candidate = parent / name
        if candidate.exists() or candidate.is_symlink():
            p = Path(name)
            candidate = parent / f'{p.stem} (重新下载 {token[:8]}){p.suffix}'
        return candidate

    def finalize(self, message):
        token = message['token']
        receipt = self.config['receipts'].get(token)
        if receipt:
            return receipt
        pending = self.config['pending'].get(token)
        if not pending:
            raise ValueError('找不到下载任务，请重新核实')
        root = self.root(pending['rootId'])
        item = pending['item']
        source = Path(message['source'])
        absolute = source.absolute()
        if source.is_symlink() or source.resolve() != absolute:
            raise ValueError('临时下载路径不能包含符号链接')
        if source.parent.name != token or source.parent.parent.name != '_BB_Downloads':
            raise ValueError('只接受本助手任务专属暂存目录中的文件')
        if not source.is_file() or source.name.endswith(('.crdownload', '.part')):
            raise ValueError('文件尚未下载完成')
        size = source.stat().st_size
        if not size:
            raise ValueError('下载得到空文件')
        expected = item.get('size')
        if expected and size != expected:
            raise ValueError(f'文件大小不符：预期 {expected}，实际 {size}。请人工核实后重试')
        with source.open('rb') as inp:
            prefix = inp.read(8192)
        lower = prefix.lower()
        if b'<html' in lower and (b'password' in lower or b'login' in lower or b'sign in' in lower):
            raise ValueError('下载得到登录页面，请重新登录 BB')
        suffix = Path(item['name']).suffix.lower()
        if suffix in ('.docx', '.pptx', '.xlsx') and not prefix.startswith(b'PK'):
            raise ValueError('Office 文件格式不符，可能返回了错误页面')
        if suffix == '.pdf' and b'%PDF-' not in prefix[:1024]:
            raise ValueError('PDF 文件格式不符')
        if suffix in ('.mp4', '.m4v', '.mov') and b'ftyp' not in prefix[:64]:
            raise ValueError('视频文件格式不符')
        meta = self.metadata(root)
        incoming = meta / 'incoming'
        if incoming.is_symlink():
            raise ValueError('暂存目录不能是符号链接')
        incoming.mkdir(exist_ok=True)
        temp = incoming / f'{token}.part'
        digest = hashlib.sha256()
        if temp.is_symlink():
            raise ValueError('无效的暂存文件')
        with source.open('rb') as inp, temp.open('wb') as out:
            while chunk := inp.read(1024 * 1024):
                out.write(chunk)
                digest.update(chunk)
            out.flush()
            os.fsync(out.fileno())
        # Persist destination before linking; a crash cannot silently duplicate a completed copy.
        dest = root / pending['destination'] if pending.get('destination') else self.destination(root, item, token)
        if not dest.resolve().is_relative_to(root) or dest.is_symlink():
            raise ValueError('目标路径不安全')
        pending['destination'] = str(dest.relative_to(root))
        pending['sha256'] = digest.hexdigest()
        self.save()
        try:
            os.link(temp, dest)
        except FileExistsError:
            existing_hash = hashlib.sha256()
            with dest.open('rb') as inp:
                while chunk := inp.read(1024 * 1024):
                    existing_hash.update(chunk)
            if existing_hash.hexdigest() != digest.hexdigest():
                raise ValueError('目标文件已存在且内容不同，已保留本地文件')
        temp.unlink()
        saved = str(dest.relative_to(root))
        history = self.history(root)
        history['items'][item['id']] = {**item, 'savedPath': saved, 'completedAt': now(),
                                      'size': size, 'sha256': digest.hexdigest(), 'manual': False}
        self.write_history(root, history)
        receipt = {'savedPath': saved, 'size': size, 'sha256': digest.hexdigest()}
        self.config['receipts'][token] = receipt
        del self.config['pending'][token]
        self.save()
        # Only remove the completed staging file created for this exact download token.
        source.unlink()
        try:
            source.parent.rmdir()
            source.parent.parent.rmdir()
        except OSError:
            pass
        return receipt

    def handle(self, message):
        action = message.get('action')
        if action == 'write_records':
            from bb_records import write_records
            return write_records(self, message)
        if action == 'ping':
            return {'version': '1.1.0', 'roots': [{'rootId': k, 'path': v} for k, v in self.config['roots'].items()]}
        if action == 'choose_root':
            return self.choose_root(message)
        if action == 'preview':
            return self.preview(message)
        if action == 'remember':
            return self.remember(message)
        if action == 'prepare':
            return self.prepare(message)
        if action == 'finalize':
            return self.finalize(message)
        raise ValueError('不支持的操作')


def read_exact(stream, count):
    value = bytearray()
    while len(value) < count:
        chunk = stream.read(count - len(value))
        if not chunk:
            if not value:
                return None
            raise EOFError('消息不完整')
        value.extend(chunk)
    return bytes(value)


def main():
    host = Host()
    while True:
        header = read_exact(sys.stdin.buffer, 4)
        if header is None:
            break
        length = struct.unpack('=I', header)[0]
        if length > MAX_MESSAGE:
            break
        request = {}
        try:
            request = json.loads(read_exact(sys.stdin.buffer, length))
            response = {'requestId': request.get('requestId'), 'ok': True, 'result': host.handle(request)}
        except Exception as error:
            response = {'requestId': request.get('requestId'), 'ok': False, 'error': str(error)}
        encoded = json.dumps(response, ensure_ascii=False).encode('utf-8')
        if len(encoded) > 900000:
            encoded = json.dumps({'requestId': request.get('requestId'), 'ok': False,
                                  'error': '结果过大，请缩小扫描范围'}).encode('utf-8')
        sys.stdout.buffer.write(struct.pack('=I', len(encoded)) + encoded)
        sys.stdout.buffer.flush()


if __name__ == '__main__':
    main()
