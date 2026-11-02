"""决定性实验：库注册 + 11.7 schema(75.0.0) + Timelines 多时间线结构。

对照已测：
  T-PLAIN  库注册 + 明文 + 无 Timelines + 143.0.0  → 崩溃
  T-ENC    库注册 + 加密 + 无 Timelines + 143.0.0  → 崩溃
  T-PATCH  库注册 + 明文 + 无 Timelines + 75.0.0   → 提示"草稿参数修改"后崩溃
本实验只改一个变量：补上 Timelines 结构。
"""
import json, os, shutil, subprocess, sys, uuid, time

DRAFT_ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
USER_DATA = r"C:/Users/linvisxie/AppData/Local/JianyingPro/User Data"
NAME = "T-FINAL"
SRC = r"D:/Linvis-AI-Studio/out/jy-test/patched-template.json"

code = f'''
from pyJianYingDraft import DraftFolder
f = DraftFolder(r"{DRAFT_ROOT}", user_data_path=r"{USER_DATA}")
s = f.create_draft("{NAME}", 1080, 1920, fps=30, allow_replace=True)
s.save()
print("SAVED:", s.save_path)
'''
r = subprocess.run([r"D:/Linvis-AI-Studio/.venv-jy/Scripts/python.exe", "-c", code],
                   capture_output=True, text=True,
                   env={**os.environ,
                        "PYTHONPATH": r"C:/Users/linvisxie/AppData/Local/Temp/pyjyd/pyJianYingDraft"})
print(r.stdout.strip()[-200:], r.stderr.strip()[-200:])

dst = os.path.join(DRAFT_ROOT, NAME)
info = os.path.join(dst, "draft_info.json")
content = os.path.join(dst, "draft_content.json")
shutil.move(info, content)

data = json.load(open(SRC, encoding="utf-8"))
tid = str(uuid.uuid4()).upper()
now = int(time.time() * 1e6)
data["id"] = tid
data["create_time"] = now
data["update_time"] = now
data["name"] = NAME
data["duration"] = 0
data["canvas_config"] = {"background": None, "height": 1920, "ratio": "original", "width": 1080}

json.dump(data, open(content, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

tj_dir = os.path.join(dst, "Timelines", tid)
os.makedirs(tj_dir, exist_ok=True)
shutil.copy(content, os.path.join(tj_dir, "draft_content.json"))

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

print("built:", dst)
print("new_version:", data["new_version"], "| canvas:", data["canvas_config"]["width"], "x", data["canvas_config"]["height"])
print("files:", sorted(os.listdir(dst)))
