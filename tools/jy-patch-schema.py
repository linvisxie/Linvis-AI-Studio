"""按 11.7 原生 schema 修正库生成的草稿，验证可打开性。

差异来自原生 template.tmp（11.7.0 自己写出的明文）：
  - new_version: 原生 75.0.0，库写 143.0.0
  - 缺少 cover / extra_info / group_container / mixed_track_mode_on /
    mutable_config / retouch_cover / time_marks
  - render_index_track_mode_on: 原生 False，库写 True
"""
import json, os, sys

SRC = r"D:/Linvis-AI-Studio/out/jy-test/plain-template.json"
DST = r"D:/Linvis-AI-Studio/out/jy-test/patched-template.json"

d = json.load(open(SRC, encoding="utf-8"))
d["new_version"] = "75.0.0"
d["render_index_track_mode_on"] = False
for k in ("cover", "extra_info", "group_container", "mutable_config",
          "retouch_cover", "time_marks"):
    d.setdefault(k, None)
d["mixed_track_mode_on"] = False

json.dump(d, open(DST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("patched ->", DST)
print("new_version:", d["new_version"], "| render_index_track_mode_on:", d["render_index_track_mode_on"])
print("keys:", len(d))
