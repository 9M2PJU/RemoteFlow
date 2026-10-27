"""Run with python3 on Linux; all writes stay in a temporary directory."""
import os
import ctypes
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).with_name("install-linux-desktop.sh")
glib = ctypes.CDLL('libglib-2.0.so.0')
glib.g_shell_parse_argv.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.POINTER(ctypes.c_char_p)), ctypes.c_void_p]
glib.g_shell_parse_argv.restype = ctypes.c_int
glib.g_strfreev.argtypes = [ctypes.POINTER(ctypes.c_char_p)]
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    data = root / 'user data'
    env = {**os.environ, 'XDG_DATA_HOME': str(data)}
    for name in ['remoteflow', 'Remote Flow % $ ` " \\ portable.AppImage']:
        program = root / name
        program.write_text('#!/bin/sh\nexit 0\n')
        program.chmod(0o755)
        for _ in range(2):  # Re-registering updates the same entry.
            subprocess.run(['bash', str(script), str(program)], env=env, check=True)
        desktop = (data / 'applications/remoteflow.desktop').read_text()
        values = dict(line.split('=', 1) for line in desktop.splitlines() if '=' in line)
        # Undo Desktop Entry string escaping, then Exec argument quoting and field codes.
        command = values['Exec'].replace('\\\\', '\\')
        argc = ctypes.c_int()
        argv = ctypes.POINTER(ctypes.c_char_p)()
        assert glib.g_shell_parse_argv(command.encode(), ctypes.byref(argc), ctypes.byref(argv), None)
        args = [argv[i].decode().replace('%%', '%') for i in range(argc.value)]
        glib.g_strfreev(argv)
        assert args == [str(program)], args
        assert values['StartupWMClass'] == 'remoteflow'
        assert Path(values['Icon']).read_bytes() == (script.parent.parent / 'src-tauri/icons/icon.png').read_bytes()
        subprocess.run(args, check=True)
    before = (data / 'applications/remoteflow.desktop').read_bytes()
    result = subprocess.run(['bash', str(script), str(root / 'missing')], env=env)
    assert result.returncode != 0
    assert (data / 'applications/remoteflow.desktop').read_bytes() == before
print('Portable desktop integration tests passed')
