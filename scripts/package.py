#!/usr/bin/env python3
"""Reproducible file selection for a source + macOS runtime bundle (no node_modules)."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'extension/manifest.json').read_text())['version']
dist = root / 'dist'
dist.mkdir(exist_ok=True)
target = dist / f'BB-Course-Downloader-macOS-{version}.zip'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as bundle:
    for name in ['extension', 'native', 'tests', 'docs', 'scripts', 'README.md', 'VALIDATION.md',
                 'extension-id.txt', '安装助手.command', 'package.json', 'package-lock.json']:
        p = root / name
        for f in sorted(p.rglob('*')) if p.is_dir() else [p]:
            if f.is_file() and '__pycache__' not in f.parts and f.name != '.DS_Store':
                bundle.write(f, Path('BB-Course-Downloader') / f.relative_to(root))
with zipfile.ZipFile(target) as bundle:
    assert bundle.testzip() is None
checksum = hashlib.sha256(target.read_bytes()).hexdigest()
(dist / 'SHA256SUMS.txt').write_text(f'{checksum}  {target.name}\n')
print(target)
