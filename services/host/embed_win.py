"""Win32 window positioning for the separate, session-owned Unity Player."""
import ctypes
import ctypes.wintypes as wt
import time

user32 = ctypes.WinDLL('user32', use_last_error=True)
try:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # per-monitor v2, physical pixels
except (AttributeError, OSError):
    pass
WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
user32.EnumChildWindows.argtypes = (wt.HWND, WNDENUMPROC, wt.LPARAM)
user32.GetWindowThreadProcessId.argtypes = (wt.HWND, ctypes.POINTER(wt.DWORD))
user32.GetWindowLongPtrW.argtypes = (wt.HWND, ctypes.c_int)
user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
user32.SetWindowPos.argtypes = (wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT)
user32.SetWindowPos.restype = wt.BOOL
user32.ShowWindow.argtypes = (wt.HWND, ctypes.c_int)
user32.IsWindow.argtypes = (wt.HWND,)
user32.IsWindow.restype = wt.BOOL
user32.GetWindowRect.argtypes = (wt.HWND, ctypes.POINTER(wt.RECT))
user32.ClientToScreen.argtypes = (wt.HWND, ctypes.POINTER(wt.POINT))

class EmbeddedPlayer:
    def __init__(self, parent, pid):
        self.parent, self.pid, self.hwnd = parent, pid, None

    def discover(self, timeout=25):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            matches = []
            @WNDENUMPROC
            def visit(hwnd, unused):
                pid = wt.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value == self.pid and user32.GetWindowLongPtrW(hwnd, -21) & 1:
                    matches.append(hwnd)
                return True
            user32.EnumChildWindows(self.parent, visit, 0)
            if len(matches) == 1:
                self.hwnd = matches[0]
                return
            if len(matches) > 1:
                raise RuntimeError('More than one initialized Unity child window')
            time.sleep(.1)
        raise TimeoutError('Unity child window did not initialize')

    def position(self, rect):
        if not self.hwnd or not user32.IsWindow(self.hwnd):
            raise RuntimeError('Unity child window is unavailable')
        if not rect['visible']:
            user32.ShowWindow(self.hwnd, 0)
            return
        # Electron's native menu shifts web content relative to the Win32 client origin.
        outer, client = wt.RECT(), wt.POINT(0, 0)
        if not user32.GetWindowRect(self.parent, ctypes.byref(outer)) or not user32.ClientToScreen(self.parent, ctypes.byref(client)):
            raise ctypes.WinError(ctypes.get_last_error())
        x = rect['x'] + (rect['insetX'] - (client.x - outer.left) if 'insetX' in rect else 0)
        y = rect['y'] + (rect['insetY'] - (client.y - outer.top) if 'insetY' in rect else 0)
        ok = user32.SetWindowPos(self.hwnd, 0, x, y, rect['width'], rect['height'],
                                 0x0010 | 0x0040 | 0x0200)  # NOACTIVATE | SHOWWINDOW | NOOWNERZORDER
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())
