"""用 pyJianYingDraft 的官方隔离 CLI 加解密剪映草稿。

为什么要用子进程跑 draft_crypto.py 而不是直接调 Python API:
  - 剪映的 videoeditor.dll 是 C++ ABI，同进程内多次加载易崩溃
  - 库作者自己就是这么做的（_run_isolated 调 sys.executable draft_crypto.py）
  - 走官方入口能拿到它内部的错误信息，而不是静默的空输出

用法:
  python tools/jy-crypt.py decrypt <in> <out>
  python tools/jy-crypt.py encrypt <in> <out>
  python tools/jy-crypt.py probe  <in>          # 只判断是否明文
"""
import os
import subprocess
import sys

LIB = r"C:\Users\linvisxie\AppData\Local\Temp\pyjyd\pyJianYingDraft\pyJianYingDraft\draft_crypto.py"
DEFAULT_INSTALL = r"D:/JianyingPro/11.7.0.14652"


def probe(path):
    d = open(path, "rb").read()
    if not d:
        return "EMPTY"
    if d[:1] in (b"{", b"["):
        return "JSON"
    return "ENCRYPTED"


def main():
    if len(sys.argv) < 3:
        print("usage: jy-crypt.py decrypt|encrypt <in> <out> | probe <in>")
        return 2

    mode = sys.argv[1]

    if mode == "probe":
        print(probe(sys.argv[2]))
        return 0

    if len(sys.argv) < 4:
        print("usage: jy-crypt.py decrypt|encrypt <in> <out>")
        return 2

    src, dst = sys.argv[2], sys.argv[3]
    install = sys.argv[4] if len(sys.argv) > 4 else os.environ.get("JY_INSTALL_DIR", DEFAULT_INSTALL)

    if not os.path.exists(LIB):
        print(f"lib not found: {LIB}")
        return 1
    if not os.path.exists(src):
        print(f"input not found: {src}")
        return 2

    flag = "--enc" if mode == "encrypt" else "--dec"
    env = {**os.environ, "JY_INSTALL_DIR": install}

    r = subprocess.run(
        [sys.executable, LIB, flag, src, dst],
        capture_output=True, text=True, env=env, timeout=180,
    )

    # 过滤剪映 DLL 自己打到 stdout 的噪声行
    noise = ("espresso", "mobilecv", "bytenn")
    out = "\n".join(l for l in (r.stdout or "").splitlines() if not any(n in l for n in noise)).strip()
    err = "\n".join(l for l in (r.stderr or "").splitlines() if not any(n in l for n in noise)).strip()

    if r.returncode != 0:
        print(f"{mode} FAILED (exit {r.returncode})")
        if out:
            print("stdout:", out[-800:])
        if err:
            print("stderr:", err[-800:])
        return 1

    if not os.path.exists(dst):
        print(f"{mode} FAILED: no output file")
        if out:
            print("stdout:", out[-800:])
        return 1

    n = os.path.getsize(dst)
    kind = probe(dst)
    print(f"{mode} ok: {os.path.getsize(src)} -> {n} bytes, result={kind}")
    if out:
        print("log:", out[-300:])
    return 0


if __name__ == "__main__":
    sys.exit(main())
