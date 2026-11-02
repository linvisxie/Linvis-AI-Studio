"""以剪映 11.7 自己写出的明文草稿为模板，添加真实片段，验证能否被 11.7 打开。

这是最后一个未测组合：
  - 模板来源：11.7 原生 template.tmp（new_version 75.0.0，56 个 material 桶）
  - 内容：本地图片 + 视频 + 两条音频 + 两条文字
  - 文件名：draft_info.json（11.6+ 要求的名字）
"""
import json, os, shutil, subprocess, sys, uuid, time

DRAFT_ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
USER_DATA = r"C:/Users/linvisxie/AppData/Local/JianyingPro/User Data"
NAME = "T-NATIVE-TPL"
A = r"D:/Linvis-AI-Studio/out/jy-test/assets"

# 1) 先用库建草稿（拿到库的注册逻辑与 meta 侧车）
code = f'''
from pyJianYingDraft import DraftFolder
f = DraftFolder(r"{DRAFT_ROOT}", user_data_path=r"{USER_DATA}")
s = f.create_draft("{NAME}", 1080, 1920, fps=30, allow_replace=True)
s.save()
'''
r = subprocess.run([r"D:/Linvis-AI-Studio/.venv-jy/Scripts/python.exe", "-c", code],
                   capture_output=True, text=True,
                   env={**os.environ,
                        "PYTHONPATH": r"C:/Users/linvisxie/AppData/Local/Temp/pyjyd/pyJianYingDraft"})
print(r.stdout.strip()[-120:], r.stderr.strip()[-200:])

dst = os.path.join(DRAFT_ROOT, NAME)
target = os.path.join(dst, "draft_info.json")

# 2) 换成 11.7 原生明文骨架
native = json.load(open(r"D:/Linvis-AI-Studio/out/jy-test/native117-plain.json", encoding="utf-8"))
tid = str(uuid.uuid4()).upper()
now = int(time.time() * 1e6)
native["id"] = tid
native["create_time"] = now
native["update_time"] = now
native["name"] = NAME
native["canvas_config"] = {"background": None, "height": 1920, "ratio": "original", "width": 1080}

# 3) 添加素材与轨道（按 11.7 原生字段风格）
def seg_id():
    return str(uuid.uuid4()).upper()

def uid():
    return str(uuid.uuid4()).upper()

mats = native["materials"]

def add_media(kind, path, duration_us, extra=None):
    mid = uid()
    base = {
        "id": mid, "path": path, "type": kind,
        "duration": duration_us, "width": 1080, "height": 1920,
        "material_name": os.path.basename(path), "category_name": "local",
        "extra_type_option": 0, "has_audio": kind == "video",
        "create_time": now, "import_time": now, "import_time_ms": now // 1000,
        "check_flag": 63487, "crop_ratio": "free", "crop_scale": 1.0,
        "crop_position_x": 0.0, "crop_position_y": 0.0,
        "crop_crop_ratio": "free", "crop_crop_scale": 1.0,
        "crop_crop_position_x": 0.0, "crop_crop_position_y": 0.0,
        "audio_fade": None, "beauty_face_preset_infos": [],
        "aigc_type": "none", "is_ai_generate_content": False,
        "local_material_id": mid, "media_path": "", "remote_url": "",
        "source_platform": 0, "team_id": "", "request_id": "", "video_algorithm": "",
        "is_unified_beauty_mode": False, "object_id": "",
        "picture_from": "none", "picture_set_category_id": "",
        "picture_set_category_name": "", "smart_motion": None,
        "reverse_intensifies_path": "", "reverse_path": "", "intensifies_path": "",
        "is_ai_generate_content": False, "proxy_path": "",
        "video_mask_path": "", "matting": {"flag": 0, "has_use_quick_brush": False,
        "has_use_quick_eraser": False, "interactive_time": [], "path": "",
        "strokes": []},
    }
    if extra:
        base.update(extra)
    mats[kind].append(base)
    return mid

IMG = add_media("videos", os.path.join(A, "bg.png").replace("\\", "/"), 4_000_000,
                {"type": "photo", "has_audio": False})
VID = add_media("videos", os.path.join(A, "clip.mp4").replace("\\", "/"), 4_000_000)

def add_audio(path, duration_us):
    mid = uid()
    mats["audios"].append({
        "id": mid, "path": path.replace("\\", "/"), "type": "extract",
        "duration": duration_us, "name": os.path.basename(path),
        "create_time": now, "import_time": now, "import_time_ms": now // 1000,
        "check_flag": 1, "category_name": "local", "extra_type_option": 0,
        "music_id": "", "app_id": 0, "source_platform": 0, "team_id": "",
        "tone_category_id": "", "tone_category_name": "", "tone_effect_id": "",
        "tone_effect_name": "", "tone_platform": "", "tone_second_category_id": "",
        "tone_second_category_name": "", "tone_speaker": "",
        "request_id": "", "video_path": "", "wave_points": [],
        "local_material_id": mid, "is_ai_clone_tone": False,
        "is_ugc_material": False, "is_ai_generate_content": False,
    })
    return mid

BGM = add_audio(os.path.join(A, "bgm.wav"), 8_000_000)
VOX = add_audio(os.path.join(A, "voice.wav"), 5_000_000)

def add_text(content, duration_us):
    mid = uid()
    mats["texts"].append({
        "id": mid, "type": "text", "content": content,
        "alignment": 1, "letter_spacing": 0.0, "line_spacing": 0.02,
        "font_size": 15.0, "font_id": "", "font_name": "",
        "font_path": "D:/Linvis-AI-Studio/video/public/fonts/NotoSansSC-VF.ttf",
        "font_resource_id": "", "text_color": "#FFFFFF", "text_alpha": 1.0,
        "background_color": "", "background_style": 0, "background_alpha": 1.0,
        "background_height": 0.14, "background_round_radius": 0.0,
        "background_width": 0.14, "background_horizontal_offset": 0.0,
        "background_vertical_offset": 0.0, "bold": False, "italic": False,
        "underline": False, "stroke_color": "", "stroke_alpha": 1.0,
        "stroke_width": 0.08, "stroke": {"width": 0.08, "color": "#000000",
        "content": ""}, "shadow": {"alpha": 0.9, "color": "#000000", "distance": 5.0,
        "angle": -45.0, "smooth": 0.33}, "shadow_color": "", "shadow_alpha": 0.9,
        "shadow_distance": 5.0, "shadow_smooth": 0.33, "shadow_angle": -45.0,
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

TITLE = add_text("V1.1 剪映原生草稿", 3_000_000)
CAP = add_text("这是一条中文字幕", 3_000_000)

# 4) 轨道
def track(kind, name):
    return {"id": uid(), "type": kind, "attribute": 0, "flag": 0, "is_default_name": False,
            "name": name, "segments": []}

def segment(material_id, start, duration, scale=None, transform=None, volume=None):
    s = {
        "id": seg_id(), "material_id": material_id, "target_timerange": {"start": start, "duration": duration},
        "source_timerange": {"start": 0, "duration": duration},
        "speed": 1.0, "volume": volume if volume is not None else 1.0,
        "extra_material_refs": [], "is_tone_modify": False,
        "clip": {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False},
                 "rotation": 0.0, "scale": {"x": scale or 1.0, "y": scale or 1.0},
                 "transform": transform or {"x": 0.0, "y": 0.0}},
        "uniform_scale": {"on": True, "value": scale or 1.0},
        "hdr_settings": {"intensity": 1.0, "mode": 1, "nits": 1000},
        "visible": True, "render_index": 0, "keyframe_refs": [],
        "common_keyframes": [], "enable_adjust": True, "enable_color_correct_adjust": False,
        "enable_color_curves": True, "enable_color_match_adjust": False,
        "enable_color_wheels": True, "enable_lut": True, "enable_smart_color_adjust": False,
        "intensifies_audio": False, "last_nonzero_volume": 1.0,
        "reverse": False, "track_attribute": 0, "track_render_index": 0,
        "responsive_layout": {"enable": False, "horizontal_pos_layout": 0,
                               "size_layout": 0, "target_follow": "", "vertical_pos_layout": 0},
        "caption_info": None, "group_id": "", "template_id": "",
        "template_scene": "default",
    }
    return s

t_bgm = track("audio", "BGM")
t_vox = track("audio", "配音")
t_main = track("video", "画面")
t_title = track("text", "标题")
t_cap = track("text", "字幕")

t_bgm["segments"].append(segment(BGM, 0, 8_000_000, volume=0.25))
t_vox["segments"].append(segment(VOX, 0, 5_000_000, volume=1.0))
t_main["segments"].append(segment(IMG, 0, 2_000_000))
t_main["segments"].append(segment(VID, 2_000_000, 4_000_000))
t_title["segments"].append(segment(TITLE, 0, 3_000_000))
t_cap["segments"].append(segment(CAP, 1_000_000, 3_000_000))

native["tracks"] = [t_bgm, t_vox, t_main, t_title, t_cap]
native["duration"] = 8_000_000

json.dump(native, open(target, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("written:", target)
print("tracks:", [(t["type"], t["name"], len(t["segments"])) for t in native["tracks"]])
print("materials:", {k: len(v) for k, v in native["materials"].items() if v})
