"""Local course catalog and generated Markdown. No fetching, no ordinary-file moves.

Each managed document has a last-written hash. A user edit is backed up before
replacement. Untracked name collisions use a different filename instead.
Catalogs are cumulative: a partial/failed scan must never erase earlier entries.
"""
import hashlib
import html
import json
import os
from pathlib import Path
from urllib.parse import quote, urlsplit
import uuid


def md(value):
    value = html.escape(str(value).replace('\n', ' ').replace('\r', ' '))
    for char in ('\\', '[', ']', '*', '_', '`', '#', '|'):
        value = value.replace(char, '\\' + char)
    return value


def web_url(value):
    value = str(value)
    u = urlsplit(value)
    if u.scheme not in ('http', 'https') or not u.netloc or u.username or u.password:
        raise ValueError('记录链接只支持不含账号密码的 HTTP(S) 地址')
    return value


def relative_link(root, target, label, document_path):
    # Path components were validated before this point; quote spaces and Markdown delimiters.
    rel = os.path.relpath(root / target, (root / document_path).parent)
    return f'[{md(label)}]({quote(rel, safe="/")})'


def write_records(host, message):
    root = host.root(message['rootId'])
    meta = host.metadata(root)
    catalog_path = meta / 'catalog.json'
    catalog = host.read_record(catalog_path, {'version': 1, 'nodes': {}, 'files': {}, 'documents': {}, 'courses': {}})
    if catalog.get('version') != 1 or any(not isinstance(catalog.get(k), dict) for k in ('nodes', 'files', 'documents', 'courses')):
        raise ValueError('课程目录记录格式损坏，请保留文件后排错')
    cid = str(message['course']['id'])
    scan_id = str(message['scanId'])
    scanned_at = str(message['scannedAt'])
    catalog['courses'][cid] = {'title': str(message['course']['title']), 'scannedAt': scanned_at,
                               'scanId': scan_id, 'scope': message.get('scope'), 'warnings': message.get('warnings', [])}
    touched = []
    for raw in message['nodes']:
        # Reuse the native host's independent path boundary, never trust JS sanitization alone.
        checked = host.validate_item({'id': str(raw['id']), 'name': 'record.md', 'folders': raw['path']})
        source = web_url(raw['url'])
        if urlsplit(source).hostname != 'bb.cuhk.edu.cn':
            raise ValueError('课程条目来源必须是学校 BB')
        links = [{'title': str(l['title']), 'url': web_url(l['url'])} for l in raw.get('links', [])]
        node = {**raw, 'path': checked['folders'], 'links': links, 'courseId': cid,
                'scanId': scan_id, 'scannedAt': scanned_at}
        key = cid + ':' + checked['id']
        catalog['nodes'][key] = node
        touched.append(node)
    for raw in message['items']:
        item = host.validate_item(raw)
        catalog['files'][item['id']] = {**item, 'status': raw.get('status'), 'error': raw.get('error'),
                                       'choice': raw.get('choice'), 'url': web_url(raw['url'])}
    history = host.history(root)['items']
    backups, outputs = [], []

    def checked_path(parts):
        checked = host.validate_item({'id': 'record', 'name': parts[-1], 'folders': parts[:-1]})
        parent = root
        for part in checked['folders']:
            parent /= part
            if parent.is_symlink():
                raise ValueError('记录目标目录不能是符号链接')
            parent.mkdir(exist_ok=True)
        target = parent / checked['name']
        if target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ValueError('记录路径越过课程目录')
        return target

    def write_managed(parts, render):
        logical = '/'.join(parts)
        tracked = catalog['documents'].get(logical)
        actual = tracked['path'] if tracked else logical
        target = checked_path(actual.split('/'))
        if not tracked and target.exists():
            # A teacher or user may already have a file named 链接.md. Never replace it.
            stem = Path(parts[-1]).stem
            i = 1
            while target.exists():
                name = f'{stem}（BB助手{str(i) if i > 1 else ""}）.md'
                actual = '/'.join(parts[:-1] + [name])
                target = checked_path(actual.split('/'))
                i += 1
        content = render(actual).encode('utf-8')
        digest = hashlib.sha256(content).hexdigest()
        if target.exists():
            if not target.is_file():
                raise ValueError(f'记录目标不是普通文件：{actual}')
            old = target.read_bytes()
            old_hash = hashlib.sha256(old).hexdigest()
            if old_hash != digest and tracked and old_hash != tracked.get('sha256'):
                backup = target.with_name(f'{target.stem}.用户修改备份-{uuid.uuid4().hex[:10]}.md')
                with backup.open('xb') as out:
                    out.write(old)
                    out.flush()
                    os.fsync(out.fileno())
                backups.append(str(backup.relative_to(root)))
            if old_hash == digest:
                catalog['documents'][logical] = {'path': actual, 'sha256': digest}
                outputs.append(actual)
                return actual
        temp = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
        with temp.open('xb') as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, target)
        catalog['documents'][logical] = {'path': actual, 'sha256': digest}
        outputs.append(actual)
        return actual

    def file_line(fid, document_path):
        file = catalog['files'].get(fid, {'name': fid})
        record = history.get(fid)
        name = file['name']
        if record:
            saved = record.get('savedPath')
            if saved:
                # Historical paths may be stale; do not invent a valid local link.
                p = root / saved
                if p.resolve().is_relative_to(root) and p.is_file() and not p.is_symlink():
                    return relative_link(root, saved, name, document_path) + ' — 已下载 / 已核实'
                return f'{md(name)} — 历史已下载，原路径已变动：{md(saved)}'
            return f'{md(name)} — 已人工确认下载，未记录本地位置'
        state = '未下载'
        if file.get('status') == 'failed':
            state = '下载失败：' + str(file.get('error') or '请查看助手')
        elif file.get('choice') == 'skip':
            state = '本次跳过'
        return f'{md(name)} — {md(state)}'

    for node in touched:
        if node['fileIds'] or node['links']:
            # Resource-bearing items get directories even if their one shared file
            # lives elsewhere. Plain-text items appear only in the course index.
            checked_path(node['path'] + ['placeholder.md'])
        logical = '/'.join(node['path'] + ['链接.md'])
        if node['links'] or logical in catalog['documents']:
            def link_doc(_path, node=node):
                lines = [f'# {md(node["title"])} · 老师分享的链接', '',
                         '由 BB 助手生成；手动修改后再次更新会先备份。', '',
                         f'最近扫描：{md(node["scannedAt"])}', '',
                         f'来源：<{quote(node["url"], safe=":/?=&%#")}>', '']
                for link in node['links']:
                    lines.append(f'- [{md(link["title"])}](<{quote(link["url"], safe=":/?=&%#")}>)')
                if not node['links']:
                    lines.append('本次扫描未发现老师分享的链接。')
                return '\n'.join(lines) + '\n'
            write_managed(node['path'] + ['链接.md'], link_doc)
        shared = [fid for fid in node['fileIds'] if fid in history and
                  history[fid].get('savedPath') != '/'.join(node['path'] + [catalog['files'].get(fid, history[fid])['name']])]
        if shared:
            write_managed(node['path'] + ['附件位置.md'], lambda p, node=node, shared=shared:
                '# 附件位置\n\n同一附件只保存一份；已有文件保留原位置。\n\n' +
                '\n'.join('- ' + file_line(fid, p) for fid in shared) + '\n')

    def index_doc(document_path):
        lines = ['# 课程目录', '', 'BB 助手累计目录：局部扫描不删除此前记录。已改名或移动的文件不会自动重下载。',
                 '文件夹层级：栏目 → BB 子文件夹 → 条目标题 → 附件。', '',
                 '忽略栏目（不区分大小写）：Announcements、Discussions、Groups、Tools、Help。', '']
        for course_id, course in catalog['courses'].items():
            lines.extend([f'## {md(course["title"])}', '', f'最近扫描：{md(course["scannedAt"])}',
                          f'扫描范围：{md(json.dumps(course.get("scope"), ensure_ascii=False))}', ''])
            for warning in course.get('warnings', []):
                lines.append(f'> 扫描提示：{md(warning)}')
            for node in catalog['nodes'].values():
                if node['courseId'] != course_id:
                    continue
                lines.extend(['', f'### {md(" / ".join(node["path"]))}', ''])
                if node['scanId'] != course['scanId']:
                    lines.append('来自此前扫描，未在本次范围内重新核实。')
                if not node['fileIds'] and not node['links'] and node['kind'] == 'item':
                    lines.append('无附件或链接（正文未保存）。')
                for fid in node['fileIds']:
                    lines.append('- ' + file_line(fid, document_path))
                for link in node['links']:
                    lines.append(f'- 网页：[{md(link["title"])}](<{quote(link["url"], safe=":/?=&%#")}>)')
                lines.append(f'- BB 来源：<{quote(node["url"], safe=":/?=&%#")}>')
        return '\n'.join(lines) + '\n'

    index_path = write_managed(['课程目录.md'], index_doc)
    host.save_record(catalog_path, catalog)
    return {'indexPath': index_path, 'written': len(outputs), 'backups': backups,
            'nodes': len(touched), 'links': sum(len(n['links']) for n in touched)}
