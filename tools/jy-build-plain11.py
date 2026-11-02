"""实验：按剪映 11.x 的 Timelines/ 结构构造明文草稿，验证 11.7 能否打开。"""
import json, os, shutil, uuid, time

ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
REG = r"C:/Users/linvisxie/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft/root_meta_info.json"
SRC = r"D:/Linvis-AI-Studio/out/jy-test/plain-template.json"
META_TPL = os.path.join(ROOT, "TMP-TPL", "draft_meta_info.json")
NAME = "LINVIS-PLAIN11"

dst = os.path.join(ROOT, NAME)
if os.path.isdir(dst):
    shutil.rmtree(dst)

tid = str(uuid.uuid4()).upper()
now = int(time.time() * 1e6)

os.makedirs(os.path.join(dst, "Timelines", tid))
content = json.load(open(SRC, encoding="utf-8"))
content["id"] = tid
content["duration"] = 0

tj = os.path.join(dst, "Timelines", tid, "draft_content.json")
json.dump(content, open(tj, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(content, open(os.path.join(dst, "draft_content.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

proj = {
    "config": {"color_space": -1, "hdr_vivid": False, "mixed_track_mode_on": False,
               "render_index_track_mode_on": False, "use_float_render": False},
    "create_time": now, "id": str(uuid.uuid4()).upper(),
    "main_timeline_id": tid,
    "timelines": [{"create_time": now, "id": tid, "is_marked_delete": False,
                   "name": "时间线01", "update_time": now}],
    "update_time": now, "version": 0,
}
json.dump(proj, open(os.path.join(dst, "Timelines", "project.json"), "w", encoding="utf-8"),
          ensure_ascii=False)
json.dump({"activeTimeline": tid,
           "dockItems": [{"dockIndex": 0, "ratio": 1, "timelineIds": [tid],
                          "timelineNames": ["时间线01"]}],
           "layoutOrientation": 1},
          open(os.path.join(dst, "timeline_layout.json"), "w", encoding="utf-8"),
          ensure_ascii=False)

meta = json.load(open(META_TPL, encoding="utf-8"))
did = str(uuid.uuid4()).upper()
meta.update({"draft_id": did, "draft_name": NAME,
             "draft_fold_path": dst.replace("/", "\\"),
             "draft_root_path": ROOT.replace("/", "\\"),
             "draft_json_file": tj.replace("/", "\\"),
             "draft_cover": "",
             "tm_draft_create": now, "tm_draft_modified": now})
json.dump(meta, open(os.path.join(dst, "draft_meta_info.json"), "w", encoding="utf-8"),
          ensure_ascii=False)

reg = json.load(open(REG, encoding="utf-8"))
reg["all_draft_store"] = [e for e in reg["all_draft_store"] if e["draft_name"] != NAME]
reg["all_draft_store"].append({
    "cloud_draft_cover": False, "cloud_draft_sync": False,
    "draft_cloud_last_action_download": False, "draft_cloud_purchase_info": "",
    "draft_cloud_template_id": "", "draft_cloud_tutorial_info": "",
    "draft_cloud_videocut_purchase_info": "", "draft_cover": "",
    "draft_fold_path": dst.replace("/", "\\"), "draft_id": did,
    "draft_is_ai_shorts": False, "draft_is_cloud_temp_draft": False,
    "draft_is_infinite_canvas_draft": False, "draft_is_invisible": False,
    "draft_is_pippit_draft": False, "draft_is_web_article_video": False,
    "draft_json_file": tj.replace("/", "\\"),
    "draft_name": NAME, "draft_new_version": "",
    "draft_root_path": ROOT.replace("/", "\\"), "draft_timeline_materials_size": 0,
    "draft_type": "", "draft_web_article_video_enter_from": "",
    "pippit_avatar_url": "", "pippit_extra_info": "", "pippit_id": "", "pippit_user_name": "",
    "streaming_edit_draft_ready": True, "tm_draft_cloud_completed": "",
    "tm_draft_cloud_entry_id": -1, "tm_draft_cloud_modified": 0,
    "tm_draft_cloud_parent_entry_id": -1, "tm_draft_cloud_space_id": -1,
    "tm_draft_cloud_user_id": -1, "tm_draft_create": now, "tm_draft_modified": now,
    "tm_draft_removed": 0, "tm_duration": 0,
})
reg["draft_ids"] = len(reg["all_draft_store"])
json.dump(reg, open(REG, "w", encoding="utf-8"), ensure_ascii=False)

print("built:", dst)
print("files:", sorted(os.listdir(dst)))
print("timelines:", os.listdir(os.path.join(dst, "Timelines")))
