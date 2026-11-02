"""在隔离的子进程中调用剪映 videoeditor.dll 加密草稿明文，避免 ABI 崩溃影响主进程。"""
import importlib.util, sys

LIB = r"C:\Users\linvisxie\AppData\Local\Temp\pyjyd\pyJianYingDraft\pyJianYingDraft\draft_crypto.py"


def load():
    spec = importlib.util.spec_from_file_location("xdc", LIB)
    m = importlib.util.module_from_spec(spec)
    sys.modules["xdc"] = m
    spec.loader.exec_module(m)
    return m


def main():
    if len(sys.argv) < 3:
        print("usage: jy-crypt.py encrypt|decrypt <in> <out> [install_dir]")
        return 2
    mode, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    install = sys.argv[4] if len(sys.argv) > 4 else r"D:/JianyingPro/11.7.0.14652"
    m = load()
    data = open(src, "rb").read()
    c = m.JianyingDraftCrypto(install)
    c._enable(None, True)
    import ctypes
    in_arg = m.MsvcStringArg(data)
    out = m.MsvcString()
    if mode == "encrypt":
        c._encrypt(None, ctypes.byref(out), ctypes.byref(in_arg.value))
    else:
        param = m.MsvcStringArg(b"{}")
        ok = ctypes.c_bool(False)
        c._decrypt(None, ctypes.byref(out), ctypes.byref(in_arg.value),
                   ctypes.byref(param.value), ctypes.byref(ok))
        if not ok.value:
            print("decrypt reported failure")
    result = m._take_msvc_string(out) if out.size else b""
    if not result:
        print(f"{mode} produced empty output")
        return 1
    open(dst, "wb").write(result)
    print(f"{mode} ok: {len(data)} -> {len(result)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
