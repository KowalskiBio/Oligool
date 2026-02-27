# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

import sys
import os

block_cipher = None

# Define icon path based on platform
icon_ext = 'ico' if sys.platform == 'win32' else 'icns'
icon_path = os.path.join('frontend', 'public', f'rabbit_oligool.{icon_ext}')
# Note: the build_mac.sh creates this .icns file before running pyinstaller

datas_primer3, binaries_primer3, hiddenimports_primer3 = collect_all('primer3')
datas_rna, binaries_rna, hiddenimports_rna = collect_all('RNA')

a = Analysis(
    ['webview_app.py'],
    pathex=[os.path.abspath('.')],
    binaries=[] + binaries_primer3 + binaries_rna,
    datas=[
        ('frontend/dist', 'frontend/dist'),
        ('.bin/mafft', '.bin/mafft')
    ] + datas_primer3 + datas_rna,
    hiddenimports=['uvicorn', 'fastapi'] + hiddenimports_primer3 + hiddenimports_rna,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Oligool',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[icon_path] if os.path.exists(icon_path) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Oligool'
)

if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='Oligool.app',
        icon=icon_path if os.path.exists(icon_path) else None,
        bundle_identifier='com.oligool.app',
        info_plist={
            'NSHighResolutionCapable': 'True',
            'LSBackgroundOnly': 'False',
        }
    )
