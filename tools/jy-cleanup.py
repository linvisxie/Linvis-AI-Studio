"""清理测试草稿（仅删除本工具创建的名字，绝不触碰用户原生草稿）。"""
import json, os, shutil, sys

ROOT = r"D:/剪映/剪映草稿/JianyingPro Drafts"
UD = r"C:/Users/linvisxie/AppData/Local/JianyingPro/User Data/Projects/com.lveditor.draft/root_meta_info.json"
KEEP = {"11月2日"}          # 用户原生草稿，永远保留
PREFIXES = ("LINVIS-",)    # 只清理本工具前缀

def main():
    payload = json.load(open(UD, encoding="utf-8"))
    kept, removed = [], []
    for e in payload["all_draft_store"]:
        name = e.get("draft_name", "")
        if name in KEEP:
            kept.append(e)
        elif any(name.startswith(p) for p in PREFIXES):
            removed.append(e)
            path = e.get("draft_fold_path")
            if path and os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
        else:
            kept.append(e)   # 未知草稿：保留，不冒险
    payload["all_draft_store"] = kept
    payload["draft_ids"] = len(kept)
    json.dump(payload, open(UD, "w", encoding="utf-8"), ensure_ascii=False)
    print("removed:", [r["draft_name"] for r in removed])
    print("kept   :", [k["draft_name"] for k in kept])

if __name__ == "__main__":
    main()
