#!/usr/bin/env python
"""
Linvis 转写桥 —— 把语音转成 Remotion 字幕 JSON（帧为单位）。

支持两个引擎，自动选择可离线运行的那个：
  1. faster-whisper（更快，需要模型文件；可用本地目录避免联网）
  2. openai-whisper（本机已有 ~/.cache/whisper/base.pt，完全离线）

用法:
  python engine/py/transcribe.py --audio in.wav --out out.json --model base --language zh --fps 30

输出:
{
  "ok": true, "engine": "openai-whisper", "language": "zh", "fps": 30,
  "captions": [{from, to, text, fromSec, toSec}],
  "words":    [{text, from, to, fromSec, toSec, prob}]
}
"""
import argparse
import json
import os
import sys


def log(msg):
    print(f"[transcribe] {msg}", file=sys.stderr)


def try_faster_whisper(args, fps):
    from faster_whisper import WhisperModel

    device, compute = "cpu", "int8"
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            device, compute = "cuda", "float16"
    except Exception:
        pass

    model = WhisperModel(args.model, device=device, compute_type=compute)
    segments, info = model.transcribe(
        args.audio,
        language=None if args.language == "auto" else args.language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300},
        beam_size=5,
        initial_prompt=args.initial_prompt,
    )

    captions, words = [], []
    for seg in segments:
        captions.append({
            "from": int(round(seg.start * fps)),
            "to": int(round(seg.end * fps)),
            "fromSec": round(seg.start, 3),
            "toSec": round(seg.end, 3),
            "text": seg.text.strip(),
        })
        for w in (seg.words or []):
            words.append({
                "text": w.word.strip(),
                "from": int(round(w.start * fps)),
                "to": int(round(w.end * fps)),
                "fromSec": round(w.start, 3),
                "toSec": round(w.end, 3),
                "prob": round(float(w.probability), 4),
            })

    return {
        "ok": True,
        "engine": "faster-whisper",
        "model": args.model,
        "device": device,
        "computeType": compute,
        "language": info.language if info else args.language,
        "languageProb": round(float(info.language_probability), 4) if info else None,
        "durationSec": round(float(info.duration), 3) if info else None,
        "fps": fps,
        "captions": captions,
        "words": words,
    }


def try_openai_whisper(args, fps):
    import whisper

    model_arg = args.model
    if args.model_dir:
        cand = os.path.join(args.model_dir, f"{args.model}.pt")
        if os.path.exists(cand):
            model_arg = cand
            log(f"使用本地模型文件: {cand}")

    model = whisper.load_model(model_arg)

    result = model.transcribe(
        args.audio,
        language=None if args.language == "auto" else args.language,
        word_timestamps=True,
        verbose=False,
        initial_prompt=args.initial_prompt,
        fp16=False,
    )

    captions, words = [], []
    for seg in result.get("segments", []):
        captions.append({
            "from": int(round(seg["start"] * fps)),
            "to": int(round(seg["end"] * fps)),
            "fromSec": round(seg["start"], 3),
            "toSec": round(seg["end"], 3),
            "text": seg["text"].strip(),
        })
        for w in seg.get("words", []) or []:
            words.append({
                "text": w["word"].strip(),
                "from": int(round(w["start"] * fps)),
                "to": int(round(w["end"] * fps)),
                "fromSec": round(w["start"], 3),
                "toSec": round(w["end"], 3),
                "prob": round(float(w.get("probability", 0.0)), 4),
            })

    dur = None
    if captions:
        dur = captions[-1]["toSec"]

    return {
        "ok": True,
        "engine": "openai-whisper",
        "model": args.model,
        "device": "cpu",
        "computeType": "fp32",
        "language": result.get("language", args.language),
        "languageProb": None,
        "durationSec": dur,
        "fps": fps,
        "captions": captions,
        "words": words,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="auto",
                    help="'auto' 按引擎选默认：faster-whisper=small, openai-whisper=base")
    ap.add_argument("--model-dir", default=os.path.expanduser("~/.cache/whisper"))
    ap.add_argument("--language", default="zh")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--engine", default="auto", choices=["auto", "faster-whisper", "openai-whisper"])
    ap.add_argument("--initial-prompt", default=None)
    args = ap.parse_args()

    if not os.path.exists(args.audio):
        print(json.dumps({"ok": False, "error": f"audio not found: {args.audio}"}, ensure_ascii=False))
        return 2

    errors = []
    order = ["faster-whisper", "openai-whisper"] if args.engine == "auto" else [args.engine]

    for eng in order:
        # 各引擎模型名不通用：faster-whisper 用 small 系列，openai-whisper 用 base 系列
        model_for_engine = args.model
        if model_for_engine == "auto":
            model_for_engine = "small" if eng == "faster-whisper" else "base"
        args.model = model_for_engine

        try:
            log(f"尝试引擎: {eng} (model={model_for_engine})")
            if eng == "faster-whisper":
                result = try_faster_whisper(args, args.fps)
            else:
                result = try_openai_whisper(args, args.fps)
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            log(f"{eng} 失败 -> {msg}")
            errors.append({"engine": eng, "error": msg})
            continue

        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        log(f"成功: {eng}, captions={len(result['captions'])}, words={len(result['words'])}")
        print(json.dumps({k: v for k, v in result.items() if k not in ("captions", "words")}, ensure_ascii=False))
        return 0

    print(json.dumps({"ok": False, "error": "所有转写引擎均失败", "attempts": errors}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
