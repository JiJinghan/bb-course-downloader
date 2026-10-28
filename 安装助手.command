#!/bin/zsh
set -e
cd -- "${0:A:h}"
python3 native/install.py
print '\n按回车关闭此窗口。'
read -r
