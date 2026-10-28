#!/usr/bin/env python3
"""Explicit user-run installer. Does not install or enable a Chrome extension."""
import argparse
import json
import os
import plistlib
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

def install():
    parser=argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, default=Path.home(), help='Alternate home for installer testing')
    parser.add_argument('--browser', choices=['chrome','chrome-beta'], default='chrome')
    args=parser.parse_args()
    source=Path(__file__).resolve().parent
    package=source.parent
    extension_id=(package/'extension-id.txt').read_text().strip()
    if len(extension_id)!=32 or any(c not in 'abcdefghijklmnop' for c in extension_id):
        raise SystemExit('扩展 ID 无效')
    app=args.home/'Library/Application Support/BB Course Downloader'
    app.mkdir(parents=True,exist_ok=True)
    shutil.copytree(package/'extension',app/'extension',dirs_exist_ok=True)
    shutil.copy2(source/'host.py',app/'host.py')
    shutil.copy2(source/'bb_records.py',app/'bb_records.py')
    picker_app=app/'BB Folder Picker.app'
    picker_dir=picker_app/'Contents/MacOS'
    picker_dir.mkdir(parents=True,exist_ok=True)
    (picker_app/'Contents/Info.plist').write_bytes(plistlib.dumps({
        'CFBundleIdentifier':'cn.cuhk.bb-downloader-picker',
        'CFBundleName':'BB Folder Picker',
        'CFBundleExecutable':'folder-picker',
        'CFBundlePackageType':'APPL',
        'CFBundleVersion':'1',
        'LSUIElement':True,
        'NSHighResolutionCapable':True,
    }))
    installed_picker=picker_dir/'folder-picker'
    picker=source/'folder-picker'
    if not picker.is_file():
        print('正在编译 macOS 文件夹选择器…',flush=True)
        subprocess.run(['xcrun','swiftc',str(source/'picker.swift'),'-o',str(installed_picker)],check=True)
    else:
        shutil.copy2(picker,installed_picker)
    installed_picker.chmod(0o755)
    launcher=app/'launch-host'
    launcher.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' -u '+shlex.quote(str(app/'host.py'))+' "$@"\n')
    launcher.chmod(0o755)
    manifest={'name':'cn.cuhk.bb_downloader','description':'BB Course Downloader local file organizer',
              'path':str(launcher),'type':'stdio','allowed_origins':[f'chrome-extension://{extension_id}/']}
    for browser in (('Google/Chrome Beta' if args.browser=='chrome-beta' else 'Google/Chrome'),):
        location=args.home/'Library/Application Support'/browser/'NativeMessagingHosts'
        location.mkdir(parents=True,exist_ok=True)
        target=location/'cn.cuhk.bb_downloader.json'
        target.write_text(json.dumps(manifest,indent=2))
        target.chmod(0o600)
    print('\n本地助手安装完成。\n请在 Chrome 的 chrome://extensions 中加载以下目录：\n'+str(app/'extension'))
    print('\n扩展 ID：'+extension_id+'\n安装不会读取你的 BB 密码或 Cookie。')

if __name__=='__main__':
    install()
