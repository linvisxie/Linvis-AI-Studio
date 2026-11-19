"""最保守的草稿复制：只改目录名，内部 ID 一律不动。

背景：
  上一版改了 project.json 的 main_timeline_id，但剪映打开时仍写回旧时间线目录，
  原因是 draft_meta_info.json 是加密的、里面记录着原始 timeline id，
  改 project.json 反而造成两份元数据不一致。

  所以本实验只做一件事：把草稿目录复制成新名字，一个字节都不改。
  如果这样能打开，就证明"目录名即草稿身份"，后续只需替换内容文件。

用法: python tools/jy-clone-asis.py [新草稿名]
"""
import os
import shutil
import sys

DRAFT_ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
SRC = os.path.join(DRAFT_ROOT, "11月2日")
NAME = sys.argv[1] if len(sys.argv) > 1 else "T-ASIS"
DST = os.path.join(DRAFT_ROOT, NAME)


def main():
    if not os.path.isdir(SRC):
        print(f"source not found: {SRC}")
        return 2

    if os.path.exists(DST):
        print(f"removing existing: {DST}")
        shutil.rmtree(DST, ignore_errors=True)

    shutil.copytree(
        SRC, DST,
        ignore=shutil.ignore_patterns(".locked", "*.db-shm", "*.db-wal"),
    )
    print(f"copied: {SRC} -> {DST}")
    print("internal ids: UNCHANGED (byte-for-byte copy)")

    n = 0
    for root, _dirs, files in os.walk(DST):
        n += len(files)
    print(f"files: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
