"""单变量实验：用库的注册逻辑生成草稿，再按需替换内容文件，验证 11.7 打开行为。

用法:
  python tools/jy-probe-test.py <name> [--encrypt] [--timelines]
"""
import json, os, shutil, subprocess, sys, uuid, time

DRAFT_ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
USER_DATA = r"C:/Users/linvisxie/AppData/Local/JianyingPro/User Data"
CRYPT = r"D:/Linvis-AI-Studio/tools/jy-crypt.py"

name = sys.argv[1]
encrypt = "--encrypt" in sys.argv
timelines = "--timelines" in sys.argv
src_override = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--content=")), None)

code = f'''
import os
from pyJianYingDraft import DraftFolder
f = DraftFolder(r"{DRAFT_ROOT}", user_data_path=r"{USER_DATA}")
s = f.create_draft("{name}", 1080, 1920, fps=30, allow_replace=True)
s.save()
print("SAVED:", s.save_path)
'''
r = subprocess.run([r"D:/Linvis-AI-Studio/.venv-jy/Scripts/python.exe", "-c", code],
                   capture_output=True, text=True,
                   env={**os.environ,
                        "PYTHONPATH": r"C:/Users/linvisxie/AppData/Local/Temp/pyjyd/pyJianYingDraft"})
print(r.stdout.strip()[-300:], r.stderr.strip()[-300:])

dst = os.path.join(DRAFT_ROOT, name)
info = os.path.join(dst, "draft_info.json")
content = os.path.join(dst, "draft_content.json")
if not os.path.exists(info):
    print("no draft_info.json produced"); sys.exit(1)
shutil.move(info, content)

if src_override:
    shutil.copy(src_override, content)
    print("content overridden from", src_override)

if encrypt:
    tmp = os.path.join(dst, "_plain.tmp")
    shutil.copy(content, tmp)
    r = subprocess.run([sys.executable, CRYPT, "encrypt", tmp, content], capture_output=True, text=True)
    print("crypt:", r.stdout.strip()[-120:], r.stderr.strip()[-120:])
    os.remove(tmp)

if timelines:
    tid = str(uuid.uuid4()).upper()
    data = json.load(open(content, encoding="utf-8")) if not encrypt else None
    os.makedirs(os.path.join(dst, "Timelines", tid), exist_ok=True)
    if data is not None:
        data["id"] = tid
        json.dump(data, open(os.path.join(dst, "Timelines", tid, "draft_content.json"), "w",
                             encoding="utf-8"), ensure_ascii=False)
    now = int(time.time() * 1e6)
    json.dump({"config": {"color_space": -1, "hdr_vivid": False, "mixed_track_mode_on": False,
                          "render_index_track_mode_on": False, "use_float_render": False},
               "create_time": now, "id": str(uuid.uuid4()).upper(), "main_timeline_id": tid,
               "timelines": [{"create_time": now, "id": tid, "is_marked_delete": False,
                              "name": "时间线01", "update_time": now}],
               "update_time": now, "version": 0},
              open(os.path.join(dst, "Timelines", "project.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump({"activeTimeline": tid, "dockItems": [{"dockIndex": 0, "ratio": 1,
               "timelineIds": [tid], "timelineNames": ["时间线01"]}], "layoutOrientation": 1},
              open(os.path.join(dst, "timeline_layout.json"), "w", encoding="utf-8"), ensure_ascii=False)

print("built:", dst, "encrypt=", encrypt, "timelines=", timelines)
print("files:", sorted(os.listdir(dst)))
