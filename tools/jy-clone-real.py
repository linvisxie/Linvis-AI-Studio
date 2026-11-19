"""基线测试：复制用户真实草稿，只改必要元数据，验证能否被 11.7 打开。

这是排除所有格式猜测的关键实验：
  - 内容：完全复用剪映自己写出的加密草稿（一个字节都不改）
  - 只改：草稿目录名、project.json 的 id/main_timeline_id、时间戳、名称
  - 如果这样都打不开，说明问题不在 schema 而在别处（如注册表/侧车）

用法: python tools/jy-clone-real.py [新草稿名]
"""
import json
import os
import shutil
import sys
import time
import uuid

DRAFT_ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
SRC = os.path.join(DRAFT_ROOT, "11月2日")
NAME = sys.argv[1] if len(sys.argv) > 1 else "T-CLONE"
# 草稿直接放 Draft Root 下（与 "11月2日" 同级）。
# 之前错误地放进了 "11月3日"（它本身就个草稿目录），造成嵌套。
DST = os.path.join(DRAFT_ROOT, NAME)


def new_upper_uuid():
    return str(uuid.uuid4()).upper()


def main():
    if not os.path.isdir(SRC):
        print(f"source not found: {SRC}")
        return 2

    if os.path.exists(DST):
        print(f"destination exists, removing: {DST}")
        shutil.rmtree(DST)

    # 1) 整目录复制（含加密草稿、封面、侧车），但跳过 .locked 等运行时锁
    shutil.copytree(SRC, DST, ignore=shutil.ignore_patterns('.locked', '*.db-shm', '*.db-wal'))
    print(f"copied: {SRC} -> {DST}")

    # 2) 生成新的时间线 ID，并删掉旧时间线目录
    #    （之前只重命名了一个，旧的还被一起复制过来，造成两套时间线共存）
    old_ids = []
    tls_dir = os.path.join(DST, "Timelines")
    for entry in os.listdir(tls_dir):
        p = os.path.join(tls_dir, entry)
        if os.path.isdir(p) and len(entry) == 36:
            old_ids.append(entry)

    if not old_ids:
        print("no timeline dir found")
        return 1

    new_tl = new_upper_uuid()
    keep = os.path.join(tls_dir, old_ids[0])
    os.rename(keep, os.path.join(tls_dir, new_tl))
    print(f"timeline id: {old_ids[0]} -> {new_tl}")

    for extra in old_ids[1:]:
        shutil.rmtree(os.path.join(tls_dir, extra))
        print(f"removed duplicate timeline dir: {extra}")

    now_us = int(time.time() * 1e6)

    # 3) project.json（指向新时间线）
    pj = os.path.join(tls_dir, "project.json")
    proj = json.load(open(pj, encoding="utf-8"))
    proj["id"] = new_upper_uuid()
    proj["main_timeline_id"] = new_tl
    proj["create_time"] = now_us
    proj["update_time"] = now_us
    for t in proj.get("timelines", []):
        t["id"] = new_tl
        t["create_time"] = now_us
        t["update_time"] = now_us
        t["name"] = "时间线01"
    json.dump(proj, open(pj, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # 4) timeline_layout.json
    tl_path = os.path.join(DST, "timeline_layout.json")
    if os.path.exists(tl_path):
        layout = json.load(open(tl_path, encoding="utf-8"))
        layout["activeTimeline"] = new_tl
        for d in layout.get("dockItems", []):
            d["timelineIds"] = [new_tl]
            d["timelineNames"] = ["时间线01"]
        json.dump(layout, open(tl_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # 5) draft_settings 时间戳
    ds = os.path.join(DST, "draft_settings")
    if os.path.exists(ds):
        txt = open(ds, encoding="utf-8").read()
        txt = txt.replace("draft_create_time=", f"draft_create_time={int(time.time())}")
        open(ds, "w", encoding="utf-8").write(txt)

    # 6) draft_meta_info.json 是加密的，不动；但草稿显示名来自目录名
    print(f"\n=== done: {NAME} ===")
    print(f"path: {DST}")
    for f in sorted(os.listdir(DST)):
        p = os.path.join(DST, f)
        if os.path.isfile(p):
            print(f"  {os.path.getsize(p):>8} {f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
