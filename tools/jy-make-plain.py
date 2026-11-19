"""决定性实验：以剪映 11.7 自己创建的空草稿为骨架，写入明文 draft_content.json。

与之前所有失败实验的关键差异（这三点是上一轮没做对的）：
  1. 文件名用 draft_content.json（不是库默认的 draft_info.json）
     —— VECreator.dll 的 DraftLoadVerifier 只认 draft_content.json
  2. new_version 沿用骨架自身的 75.0.0（不是库默认的 143.0.0）
     —— check_version_support 最低要求 71.0.0，但高版本会被判 lowAppVersion
  3. 根目录与 Timelines/<id>/ 两份内容一致（剪映会读 Timelines 那份）

用法:
  python tools/jy-make-plain.py <草稿名> [--plain|--encrypted]

验证不靠截图，靠文件副作用：
  打开后若 Timelines/<id>/draft_content.json 从明文变成密文、或体积从
  空骨架级别增长到含轨道级别，说明剪映确实解析并接管了内容。
"""
import json
import os
import shutil
import sys
import time
import uuid

DRAFT_ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
SKELETON = os.path.join(DRAFT_ROOT, "11月3日")   # 剪映 11.7 自己创建的空草稿
REG = r"C:/Users/linvisxie/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft/root_meta_info.json"
ASSETS = r"D:/Linvis-AI-Studio/out/jy-test/assets"

NAME = sys.argv[1] if len(sys.argv) > 1 else "T-PLAIN11"
ENCRYPT = "--encrypted" in sys.argv
W, H, FPS = 1080, 1920, 30

US = 1_000_000  # 1 秒


def uid():
    return str(uuid.uuid4()).upper()


def main():
    if not os.path.isdir(SKELETON):
        print(f"skeleton not found: {SKELETON}")
        return 2

    dst = os.path.join(DRAFT_ROOT, NAME)
    if os.path.exists(dst):
        print(f"removing existing: {dst}")
        shutil.rmtree(dst, ignore_errors=True)

    # 1) 复制骨架（跳过运行时锁）
    shutil.copytree(SKELETON, dst,
                    ignore=shutil.ignore_patterns(".locked", "*.db-shm", "*.db-wal"))
    print(f"copied skeleton -> {dst}")

    # 2) 换一个全新时间线 ID，删掉骨架自带的旧时间线目录
    tls = os.path.join(dst, "Timelines")
    old = [d for d in os.listdir(tls)
           if os.path.isdir(os.path.join(tls, d)) and len(d) == 36]
    for d in old:
        shutil.rmtree(os.path.join(tls, d), ignore_errors=True)
    tid = uid()
    os.makedirs(os.path.join(tls, tid))
    print(f"timeline id: {old[0] if old else '(none)'} -> {tid}")

    now = int(time.time() * US)

    # 3) 以骨架的明文 template.tmp 为 schema 基底
    base = json.load(open(os.path.join(SKELETON, "Timelines", old[0], "template.tmp"),
                          encoding="utf-8"))
    base["id"] = tid
    base["create_time"] = now
    base["update_time"] = now
    base["name"] = NAME
    base["duration"] = 8 * US
    base["canvas_config"] = {"background": None, "height": H,
                             "ratio": "original", "width": W}
    base["fps"] = float(FPS)
    base["draft_type"] = "video"
    # 关键：保持 75.0.0，不要用库默认的 143.0.0
    base["new_version"] = "75.0.0"

    mats = base["materials"]

    def add_video(path, dur, is_photo=False):
        mid = uid()
        mats["videos"].append({
            "id": mid, "path": path.replace("\\", "/"),
            "type": "photo" if is_photo else "video",
            "duration": dur, "width": W, "height": H,
            "material_name": os.path.basename(path), "category_name": "local",
            "extra_type_option": 0, "has_audio": not is_photo,
            "create_time": now, "import_time": now, "import_time_ms": now // 1000,
            "check_flag": 63487,
            "crop_ratio": "free", "crop_scale": 1.0,
            "crop_position_x": 0.0, "crop_position_y": 0.0,
            "crop_crop_ratio": "free", "crop_crop_scale": 1.0,
            "crop_crop_position_x": 0.0, "crop_crop_position_y": 0.0,
            "audio_fade": None, "beauty_face_preset_infos": [],
            "aigc_type": "none", "is_ai_generate_content": False,
            "local_material_id": mid, "media_path": "", "remote_url": "",
            "source_platform": 0, "team_id": "", "object_id": "", "request_id": "",
            "video_algorithm": "", "is_unified_beauty_mode": False,
            "picture_from": "none", "picture_set_category_id": "",
            "picture_set_category_name": "", "smart_motion": None,
            "reverse_intensifies_path": "", "reverse_path": "", "intensifies_path": "",
            "proxy_path": "", "video_mask_path": "",
            "matting": {"flag": 0, "has_use_quick_brush": False,
                        "has_use_quick_eraser": False, "interactive_time": [],
                        "path": "", "strokes": []},
        })
        return mid

    def add_audio(path, dur):
        mid = uid()
        mats["audios"].append({
            "id": mid, "path": path.replace("\\", "/"), "type": "extract",
            "duration": dur, "name": os.path.basename(path),
            "create_time": now, "import_time": now, "import_time_ms": now // 1000,
            "check_flag": 1, "category_name": "local", "extra_type_option": 0,
            "music_id": "", "app_id": 0, "source_platform": 0, "team_id": "",
            "tone_category_id": "", "tone_category_name": "", "tone_effect_id": "",
            "tone_effect_name": "", "tone_platform": "",
            "tone_second_category_id": "", "tone_second_category_name": "",
            "tone_speaker": "", "request_id": "", "video_path": "",
            "wave_points": [], "local_material_id": mid,
            "is_ai_clone_tone": False, "is_ugc_material": False,
            "is_ai_generate_content": False,
        })
        return mid

    def add_text(content, dur):
        mid = uid()
        mats["texts"].append({
            "id": mid, "type": "text", "content": content,
            "alignment": 1, "letter_spacing": 0.0, "line_spacing": 0.02,
            "font_size": 15.0, "font_id": "", "font_name": "", "font_path": "",
            "font_resource_id": "", "text_color": "#FFFFFF", "text_alpha": 1.0,
            "background_color": "", "background_style": 0, "background_alpha": 1.0,
            "background_height": 0.14, "background_round_radius": 0.0,
            "background_width": 0.14, "background_horizontal_offset": 0.0,
            "background_vertical_offset": 0.0, "bold": False, "italic": False,
            "underline": False, "stroke_color": "", "stroke_alpha": 1.0,
            "stroke_width": 0.08,
            "stroke": {"width": 0.08, "color": "#000000", "content": ""},
            "shadow": {"alpha": 0.9, "color": "#000000", "distance": 5.0,
                       "angle": -45.0, "smooth": 0.33},
            "shadow_color": "", "shadow_alpha": 0.9, "shadow_distance": 5.0,
            "shadow_smooth": 0.33, "shadow_angle": -45.0,
            "border_alpha": 1.0, "border_color": "", "border_width": 0.08,
            "text_size": 30, "text_box_width": 600.0, "text_box_height": 100.0,
            "fixed_width": 780.0, "fixed_height": -1.0, "line_feed": 1,
            "use_effect_default_color": True, "typesetting": 0,
            "check_flag": 15, "create_time": now, "group_id": "",
            "recognize_type": 0, "relevance_segment": [],
            "words": {"text": [], "start_time": [], "end_time": []},
            "initial_scale": 1.0, "is_bold": False,
        })
        return mid

    IMG = add_video(os.path.join(ASSETS, "bg.png"), 4 * US, is_photo=True)
    VID = add_video(os.path.join(ASSETS, "clip.mp4"), 6 * US)
    BGM = add_audio(os.path.join(ASSETS, "bgm.wav"), 8 * US)
    VOX = add_audio(os.path.join(ASSETS, "voice.wav"), 5 * US)
    TITLE = add_text("V1.1 剪映原生草稿", 3 * US)
    CAP = add_text("这是一条中文字幕", 3 * US)

    def track(kind, name):
        return {"id": uid(), "type": kind, "attribute": 0, "flag": 0,
                "is_default_name": False, "name": name, "segments": []}

    def seg(mat_id, start, dur, volume=1.0, render_index=0):
        return {
            "id": uid(), "material_id": mat_id,
            "target_timerange": {"start": start, "duration": dur},
            "source_timerange": {"start": 0, "duration": dur},
            "speed": 1.0, "volume": volume,
            "extra_material_refs": [], "is_tone_modify": False,
            "clip": {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False},
                     "rotation": 0.0, "scale": {"x": 1.0, "y": 1.0},
                     "transform": {"x": 0.0, "y": 0.0}},
            "uniform_scale": {"on": True, "value": 1.0},
            "hdr_settings": {"intensity": 1.0, "mode": 1, "nits": 1000},
            "visible": True, "render_index": render_index, "keyframe_refs": [],
            "common_keyframes": [], "enable_adjust": True,
            "enable_color_correct_adjust": False, "enable_color_curves": True,
            "enable_color_match_adjust": False, "enable_color_wheels": True,
            "enable_lut": True, "enable_smart_color_adjust": False,
            "intensifies_audio": False, "last_nonzero_volume": volume,
            "reverse": False, "track_attribute": 0,
            "track_render_index": render_index,
            "responsive_layout": {"enable": False, "horizontal_pos_layout": 0,
                                  "size_layout": 0, "target_follow": "",
                                  "vertical_pos_layout": 0},
            "caption_info": None, "group_id": "", "template_id": "",
            "template_scene": "default",
        }

    t_bgm = track("audio", "BGM")
    t_vox = track("audio", "配音")
    t_main = track("video", "画面")
    t_title = track("text", "标题")
    t_cap = track("text", "字幕")

    t_bgm["segments"].append(seg(BGM, 0, 8 * US, volume=0.25))
    t_vox["segments"].append(seg(VOX, 0, 5 * US, volume=1.0))
    t_main["segments"].append(seg(IMG, 0, 2 * US))
    t_main["segments"].append(seg(VID, 2 * US, 6 * US))
    t_title["segments"].append(seg(TITLE, 0, 3 * US, render_index=14000))
    t_cap["segments"].append(seg(CAP, 1 * US, 3 * US, render_index=15000))

    base["tracks"] = [t_bgm, t_vox, t_main, t_title, t_cap]

    plain = json.dumps(base, ensure_ascii=False, indent=2)
    payload = plain.encode("utf-8")

    if ENCRYPT:
        import subprocess
        tmp = os.path.join(dst, "_plain.tmp")
        open(tmp, "w", encoding="utf-8").write(plain)
        r = subprocess.run([sys.executable,
                            r"D:/Linvis-AI-Studio/tools/jy-crypt.py",
                            "encrypt", tmp, os.path.join(tls, tid, "draft_content.json")],
                           capture_output=True, text=True)
        print("encrypt:", (r.stdout or r.stderr).strip()[-200:])
        os.remove(tmp)
    else:
        open(os.path.join(tls, tid, "draft_content.json"), "wb").write(payload)

    # 4) 根目录同名文件（11.7 两份都会读，必须一致）
    shutil.copy(os.path.join(tls, tid, "draft_content.json"),
                os.path.join(dst, "draft_content.json"))

    # 5) project.json / timeline_layout.json
    proj = json.load(open(os.path.join(tls, "project.json"), encoding="utf-8"))
    proj["id"] = uid()
    proj["main_timeline_id"] = tid
    proj["create_time"] = now
    proj["update_time"] = now
    proj["timelines"] = [{"create_time": now, "id": tid, "is_marked_delete": False,
                          "name": "时间线01", "update_time": now}]
    json.dump(proj, open(os.path.join(tls, "project.json"), "w", encoding="utf-8"),
              ensure_ascii=False)

    layout = json.load(open(os.path.join(dst, "timeline_layout.json"), encoding="utf-8"))
    layout["activeTimeline"] = tid
    for d in layout.get("dockItems", []):
        d["timelineIds"] = [tid]
        d["timelineNames"] = ["时间线01"]
    json.dump(layout, open(os.path.join(dst, "timeline_layout.json"), "w", encoding="utf-8"),
              ensure_ascii=False)

    # 6) 注册到剪映草稿列表
    reg = json.load(open(REG, encoding="utf-8"))
    reg["all_draft_store"] = [e for e in reg["all_draft_store"]
                              if e.get("draft_name") != NAME]
    tpl = reg["all_draft_store"][0]
    entry = dict(tpl)
    entry.update({
        "draft_name": NAME,
        "draft_fold_path": dst.replace("/", "\\"),
        "draft_root_path": DRAFT_ROOT.replace("/", "\\"),
        "draft_json_file": os.path.join(tls, tid, "draft_content.json").replace("/", "\\"),
        "draft_cover": "", "draft_id": uid(),
        "tm_draft_create": now, "tm_draft_modified": now, "tm_duration": 8 * US,
    })
    reg["all_draft_store"].append(entry)
    reg["draft_ids"] = len(reg["all_draft_store"])
    json.dump(reg, open(REG, "w", encoding="utf-8"), ensure_ascii=False)

    print(f"\n=== built: {NAME} ===")
    print(f"path      : {dst}")
    print(f"timeline  : {tid}")
    print(f"content   : {'ENCRYPTED' if ENCRYPT else 'PLAINTEXT'} ({len(payload)} bytes)")
    print(f"tracks    : {[(t['type'], t['name'], len(t['segments'])) for t in base['tracks']]}")
    print(f"materials : videos={len(mats['videos'])} audios={len(mats['audios'])} texts={len(mats['texts'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
