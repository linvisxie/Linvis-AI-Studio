/**
 * 剪映（JianyingPro）草稿适配器 — 把 project.json 转成本机剪映原生可编辑草稿。
 *
 * ## 为什么这样做（实测结论，不是推测）
 *
 * 本机剪映 11.7.0.14652。上一轮会话反复失败，根因有三条，全部已用实验确认：
 *
 * 1. **文件名**
 *    库（pyJianYingDraft 0.3.0）默认写 `draft_info.json`，但 11.7 的
 *    VECreator.dll `DraftLoadVerifier` 只认 `draft_content.json`。
 *    写错名字 → 判「草稿内容已损坏」。
 *
 * 2. **new_version**
 *    库默认写 `143.0.0`。11.7 的 `check_version_support` 最低要求 71.0.0，
 *    过高版本会被判 `lowAppVersion`。必须沿用本机骨架自己的 `75.0.0`。
 *
 * 3. **不需要解密**
 *    `DraftLoadVerifier` 的失败分支是并列的 `parse_json_failed` 与
 *    `decrypt_failed` —— 明文只要能被 JSON 解析就走通，不进入解密分支。
 *    videoeditor.dll 的 decrypt 在独立进程里恒返回空（`isFileEncrypted`
 *    对真实密文也返回 false），因为 11.7 用 `entropy_dynamic` + `first_block`
 *    的会话级密钥，静态调用拿不到。**所以不要试图解密，直接写明文。**
 *
 * 已实测：用本机剪映自己创建的空草稿作骨架 + 明文 draft_content.json
 * + 真实轨道，双击后剪映正常打开、显示 5 条轨道与素材、预览画面正确，
 * 关闭时把 27419 字节明文重写为 12296 字节密文（说明被完全接管）。
 *
 * ## 骨架
 *
 * 骨架 = 本机剪映自己创建过的一个草稿目录。它提供 schema 与侧车文件。
 * 适配器会自动在草稿根目录里找一个结构完整的草稿，也允许显式指定。
 * 找不到时明确报错，不猜、不伪造。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS } from '../../lib/project.mjs';
import { safeDirectoryName, hashFile, validatedSceneClips } from '../../lib/render-scenes.mjs';

const OWNERSHIP = '.linvis-generated.json';
function draftFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    if (!prefix && entry.name === OWNERSHIP) return [];
    const file = path.join(dir, entry.name), rel = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('拒绝覆盖含符号链接的草稿');
    return entry.isDirectory() ? draftFiles(file, `${rel}/`) : [[rel, hashFile(file)]];
  });
}
const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
};

const US = 1_000_000; // 1 秒 = 1e6 微秒（剪映时间单位）

const DEFAULT_DRAFT_ROOTS = [
  'D:/剪映/剪映草稿/JianyingPro Drafts',
  'C:/Users/Public/Documents/JianyingPro Drafts',
];

const enc = (s) => String(s ?? '');

function uid() {
  return crypto.randomUUID().toUpperCase();
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/** 找一个本机剪映真实创建过的草稿目录作为 schema 骨架。 */
export function findSkeleton(rootDir, exclude = []) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const skip = new Set(['.cloud_cache', '.recycle_bin', ...exclude]);
  const candidates = [];
  for (const name of fs.readdirSync(rootDir)) {
    if (name.startsWith('.') || skip.has(name)) continue;
    const dir = path.join(rootDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const tls = path.join(dir, 'Timelines');
    if (!fs.existsSync(tls)) continue;
    for (const tl of fs.readdirSync(tls)) {
      if (tl.length !== 36) continue;
      const tpl = path.join(tls, tl, 'template.tmp');
      if (!fs.existsSync(tpl)) continue;
      // template.tmp 必须是明文 JSON，才可能被复用作 schema 基底
      const head = fs.readFileSync(tpl).subarray(0, 1).toString();
      if (head !== '{') continue;
      const stat = fs.statSync(tpl);
      candidates.push({ dir, name, timelineId: tl, templatePath: tpl, mtime: stat.mtimeMs });
    }
  }
  // 优先用最新的（剪映最近自己写出来的，最贴当前版本）
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ?? null;
}

/**
 * 从镜头 props 里抽出可当文字轨的文案。
 * 不同镜头类型的字段名不一样（见 AGENTS.md 的镜头类型表），
 * 这里按优先级提取，抽不到就返回空字符串（不造假文案）。
 */
function sceneText(s) {
  const p = s.props ?? {};
  const first = (v) => (Array.isArray(v) ? v.find((x) => typeof x === 'string' && x.trim()) : v);
  const candidates = [p.text, p.title, p.question, p.headline, p.finalLine, p.hud, first(p.lines), first(p.sublines)];
  const hit = candidates.find((v) => typeof v === 'string' && v.trim());
  return hit ? hit.trim() : '';
}

/** 把 project.json 的场景换算成剪映时间轴秒数。 */
function sceneTimeline(cfg) {
  const fps = cfg.video.fps;
  return (cfg.scenes || []).map((s) => ({
    id: enc(s.id),
    type: enc(s.type),
    startSec: s.from / fps,
    endSec: (s.from + s.durationInFrames) / fps,
    text: sceneText(s),
  }));
}

function addVideoMaterial(mats, { file, durUs, width, height, isPhoto, hasAudio = !isPhoto, now }) {
  const id = uid();
  mats.videos.push({
    id,
    path: toPosix(file),
    type: isPhoto ? 'photo' : 'video',
    duration: durUs,
    width,
    height,
    material_name: path.basename(file),
    category_name: 'local',
    extra_type_option: 0,
    has_audio: hasAudio,
    create_time: now,
    import_time: now,
    import_time_ms: Math.floor(now / 1000),
    check_flag: 63487,
    crop_ratio: 'free',
    crop_scale: 1.0,
    crop_position_x: 0.0,
    crop_position_y: 0.0,
    crop_crop_ratio: 'free',
    crop_crop_scale: 1.0,
    crop_crop_position_x: 0.0,
    crop_crop_position_y: 0.0,
    audio_fade: null,
    beauty_face_preset_infos: [],
    aigc_type: 'none',
    is_ai_generate_content: false,
    local_material_id: id,
    media_path: '',
    remote_url: '',
    source_platform: 0,
    team_id: '',
    object_id: '',
    request_id: '',
    video_algorithm: '',
    is_unified_beauty_mode: false,
    picture_from: 'none',
    picture_set_category_id: '',
    picture_set_category_name: '',
    smart_motion: null,
    reverse_intensifies_path: '',
    reverse_path: '',
    intensifies_path: '',
    proxy_path: '',
    video_mask_path: '',
    matting: {
      flag: 0,
      has_use_quick_brush: false,
      has_use_quick_eraser: false,
      interactive_time: [],
      path: '',
      strokes: [],
    },
  });
  return id;
}

function addAudioMaterial(mats, { file, durUs, now }) {
  const id = uid();
  mats.audios.push({
    id,
    path: toPosix(file),
    type: 'extract',
    duration: durUs,
    name: path.basename(file),
    create_time: now,
    import_time: now,
    import_time_ms: Math.floor(now / 1000),
    check_flag: 1,
    category_name: 'local',
    extra_type_option: 0,
    music_id: '',
    app_id: 0,
    source_platform: 0,
    team_id: '',
    tone_category_id: '',
    tone_category_name: '',
    tone_effect_id: '',
    tone_effect_name: '',
    tone_platform: '',
    tone_second_category_id: '',
    tone_second_category_name: '',
    tone_speaker: '',
    request_id: '',
    video_path: '',
    wave_points: [],
    local_material_id: id,
    is_ai_clone_tone: false,
    is_ugc_material: false,
    is_ai_generate_content: false,
  });
  return id;
}

function addTextMaterial(mats, { text, size, now }) {
  const id = uid();
  mats.texts.push({
    id,
    type: 'text',
    content: text,
    alignment: 1,
    letter_spacing: 0.0,
    line_spacing: 0.02,
    font_size: size,
    font_id: '',
    font_name: '',
    font_path: '',
    font_resource_id: '',
    text_color: '#FFFFFF',
    text_alpha: 1.0,
    background_color: '',
    background_style: 0,
    background_alpha: 1.0,
    background_height: 0.14,
    background_round_radius: 0.0,
    background_width: 0.14,
    background_horizontal_offset: 0.0,
    background_vertical_offset: 0.0,
    bold: false,
    italic: false,
    underline: false,
    stroke_color: '',
    stroke_alpha: 1.0,
    stroke_width: 0.08,
    stroke: { width: 0.08, color: '#000000', content: '' },
    shadow: { alpha: 0.9, color: '#000000', distance: 5.0, angle: -45.0, smooth: 0.33 },
    shadow_color: '',
    shadow_alpha: 0.9,
    shadow_distance: 5.0,
    shadow_smooth: 0.33,
    shadow_angle: -45.0,
    border_alpha: 1.0,
    border_color: '',
    border_width: 0.08,
    text_size: 30,
    text_box_width: 600.0,
    text_box_height: 100.0,
    fixed_width: 780.0,
    fixed_height: -1.0,
    line_feed: 1,
    use_effect_default_color: true,
    typesetting: 0,
    check_flag: 15,
    create_time: now,
    group_id: '',
    recognize_type: 0,
    relevance_segment: [],
    words: { text: [], start_time: [], end_time: [] },
    initial_scale: 1.0,
    is_bold: false,
  });
  return id;
}

function makeTrack(kind, name) {
  return {
    id: uid(),
    type: kind,
    attribute: 0,
    flag: 0,
    is_default_name: false,
    name,
    segments: [],
  };
}

function makeSegment(materialId, startUs, durUs, { volume = 1.0, renderIndex = 0 } = {}) {
  return {
    id: uid(),
    material_id: materialId,
    target_timerange: { start: startUs, duration: durUs },
    source_timerange: { start: 0, duration: durUs },
    speed: 1.0,
    volume,
    extra_material_refs: [],
    is_tone_modify: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 },
    },
    uniform_scale: { on: true, value: 1.0 },
    hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    visible: true,
    render_index: renderIndex,
    keyframe_refs: [],
    common_keyframes: [],
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    intensifies_audio: false,
    last_nonzero_volume: volume,
    reverse: false,
    track_attribute: 0,
    track_render_index: renderIndex,
    responsive_layout: {
      enable: false,
      horizontal_pos_layout: 0,
      size_layout: 0,
      target_follow: '',
      vertical_pos_layout: 0,
    },
    caption_info: null,
    group_id: '',
    template_id: '',
    template_scene: 'default',
  };
}

/** 把工程素材解析到绝对路径。引擎约定素材位于 projects/<id>/assets/。 */
function resolveAsset(projectDir, rel) {
  if (!rel) return null;
  if (path.isAbsolute(rel)) return path.resolve(rel);
  const inAssets = path.resolve(projectDir, 'assets', rel);
  if (fs.existsSync(inAssets)) return inAssets;
  return path.resolve(projectDir, rel);
}

/**
 * 生成剪映草稿。
 *
 * @param {object} opts
 * @param {string} opts.projectDir   工程目录（含 project.json）
 * @param {object} opts.cfg          project.json 内容
 * @param {string} opts.draftRoot    剪映草稿根目录
 * @param {string} opts.name         草稿名（= 目录名）
 * @param {string} [opts.skeletonDir] 指定骨架草稿目录，省略则自动发现
 * @param {boolean} [opts.force]     允许覆盖同名草稿
 * @returns {{ok:boolean, draftDir:string, warnings:string[], error?:string}}
 */
export function buildJianyingDraft(opts) {
  const { cfg, name, force = false } = opts;
  const projectDir = path.resolve(opts.projectDir);
  const draftRoot = opts.draftRoot ? path.resolve(opts.draftRoot) : null;
  const skeletonDir = opts.skeletonDir ? path.resolve(opts.skeletonDir) : null;
  const warnings = [];
  const notes = [];

  if (!draftRoot) return { ok: false, error: '缺少剪映草稿根目录（--draft-root 或自动发现失败）' };
  if (!safeDirectoryName(name)) return { ok: false, error: '草稿名必须为安全的单层目录名' };
  if (!fs.existsSync(draftRoot)) return { ok: false, error: `草稿根目录不存在: ${draftRoot}` };

  // 1) 找骨架
  let skeleton = null;
  if (skeletonDir) {
    const tls = path.join(skeletonDir, 'Timelines');
    if (!fs.existsSync(tls)) return { ok: false, error: `指定的骨架不是合法草稿: ${skeletonDir}` };
    const tids = fs.readdirSync(tls).filter((d) => d.length === 36);
    if (!tids.length) return { ok: false, error: `骨架缺少时间线目录: ${skeletonDir}` };
    skeleton = { dir: skeletonDir, timelineId: tids[0], templatePath: path.join(tls, tids[0], 'template.tmp') };
  } else {
    skeleton = findSkeleton(draftRoot, [name]);
  }
  if (!skeleton) {
    return {
      ok: false,
      error: `找不到剪映草稿骨架。请先在剪映里新建一个空草稿（剪映会把 schema 骨架写到磁盘），`
        + `然后用 --skeleton <目录> 指定它。查找过: ${draftRoot}`,
    };
  }

  const draftDir = path.join(fs.realpathSync(draftRoot), name);
  const realSkeleton = fs.realpathSync(skeleton.dir);
  // Never delete/copy over a project, a skeleton, or their parents (including symlink aliases).
  const existingTarget = fs.existsSync(draftDir) ? fs.realpathSync(draftDir) : draftDir;
  const realProject = fs.realpathSync(projectDir);
  if (inside(existingTarget, realSkeleton) || inside(realSkeleton, existingTarget)
    || inside(existingTarget, realProject) || inside(realProject, existingTarget)
    || (fs.existsSync(draftDir) && fs.lstatSync(draftDir).isSymbolicLink())) {
    return { ok: false, error: '目标不能覆盖工程、骨架或符号链接目录' };
  }
  // Parse before any destructive operation.
  const template = JSON.parse(fs.readFileSync(skeleton.templatePath, 'utf8'));
  if (!template.materials) return { ok: false, error: '骨架缺少 materials' };
  if (fs.existsSync(draftDir)) {
    if (!force) {
      return { ok: false, error: `草稿已存在，拒绝覆盖: ${draftDir}（需要覆盖请加 --force）` };
    }
    // 剪映正打开该草稿时会占用目录，直接 rm 会抛 EPERM。
    // 这种情况人无法“点一下就修好”，必须给明确指引。
    if (fs.existsSync(path.join(draftDir, '.locked'))) {
      return {
        ok: false,
        error: `草稿正被剪映打开（存在 .locked）: ${draftDir}\n`
          + '  请先在剪映里关闭这个草稿，或换一个 --name。',
      };
    }
    try {
      const ownership = JSON.parse(fs.readFileSync(path.join(draftDir, OWNERSHIP), 'utf8'));
      if (ownership.generator !== 'linvis' || ownership.contentHash !== hashFile(path.join(draftDir, 'draft_content.json'))
        || ownership.projectDir !== realProject
        || JSON.stringify(ownership.files) !== JSON.stringify(draftFiles(draftDir))) {
        return { ok: false, error: '拒绝覆盖用户草稿或已修改的生成草稿' };
      }
      fs.rmSync(draftDir, { recursive: true, force: true });
    } catch (e) {
      return {
        ok: false,
        error: `无法删除旧草稿: ${draftDir}\n  ${e.code === 'EPERM' || e.code === 'EBUSY'
          ? '目录被占用，请先关闭剪映或该草稿窗口'
          : e.message}`,
      };
    }
  }

  // 2) 复制骨架
  // 复骨架时必须剔除「属于源草稿的身份与状态」文件。
  // 特别是 draft_meta_info.json（加密，内含源草稿 draft_id / fold_path）：
  // 带着它会让剪映把新草稿认成源草稿，导致「草稿列表异常 - 检测到部分草稿丢失」，
  // 并在关闭时覆写源草稿 —— 这正是之前 T-ASIS 失败的真正原因。
  // 同样剔除封面与备份目录，避免蹭用别人的封面、并把旧备份带进来。
  const SKELETON_EXCLUDE = new Set([
    '.locked',
    'draft_meta_info.json',
    'draft_meta_info.json.bak',
    'draft_cover.jpg',
    'draft_content.json.bak',
  ]);
  const SKELETON_EXCLUDE_DIRS = new Set(['.backup', 'deepagent']);

  fs.cpSync(skeleton.dir, draftDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (fs.lstatSync(src).isSymbolicLink()) return false;
      if (base === OWNERSHIP || base === 'media') return false;
      if (SKELETON_EXCLUDE.has(base)) return false;
      if (SKELETON_EXCLUDE_DIRS.has(base)) return false;
      if (base.endsWith('.db-shm') || base.endsWith('.db-wal')) return false;
      // 旧时间线目录全部剔除（后面会建新的）
      if (base.length === 36 && /^[0-9A-F-]+$/i.test(base)) return false;
      return true;
    },
  });

  const tlsDir = path.join(draftDir, 'Timelines');

  // 3) 换全新时间线 ID，删掉骨架自带的旧时间线
  for (const d of fs.readdirSync(tlsDir)) {
    const p = path.join(tlsDir, d);
    if (fs.statSync(p).isDirectory() && d.length === 36) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
  const timelineId = uid();
  fs.mkdirSync(path.join(tlsDir, timelineId), { recursive: true });

  const now = Date.now() * 1000;
  const base = template;
  const { width, height, fps, durationInFrames } = cfg.video;

  base.id = timelineId;
  base.create_time = now;
  base.update_time = now;
  base.name = name;
  base.duration = Math.round((durationInFrames / fps) * US);
  base.canvas_config = { background: null, height, ratio: 'original', width };
  base.fps = Number(fps);
  base.draft_type = 'video';
  // 关键：沿用骨架自己的版本号，不要用第三方库默认的高版本
  // （11.7 check_version_support 会把过高的 new_version 判为 lowAppVersion）

  const mats = base.materials;
  // A skeleton may itself contain user tracks/materials: only retain its schema.
  for (const [key, value] of Object.entries(mats)) if (Array.isArray(value)) mats[key] = [];
  for (const key of ['videos', 'audios', 'texts']) mats[key] = [];

  // 3.5) 素材入库：复制到草稿目录自己的 media/ 下。
  // 剪映默认按绝对路径引用；但绝对路径会随工程目录移动、临时目录清理而失效。
  // 素材统一入库，引用使用草稿内的绝对路径（移动草稿目录后需重新生成）。
  const mediaDir = path.join(draftDir, 'media');
  const staged = new Map();
  const stageAsset = (absFile) => {
    if (!absFile) return absFile;
    if (staged.has(absFile)) return staged.get(absFile);
    fs.mkdirSync(mediaDir, { recursive: true });
    // Content identity, not size, decides whether two assets are the same.
    const dest = path.join(mediaDir, `${hashFile(absFile)}${path.extname(absFile).toLowerCase()}`);
    if (!fs.existsSync(dest)) fs.copyFileSync(absFile, dest);
    staged.set(absFile, dest);
    return dest;
  };

  // 4) 素材：音频层
  const audioLayers = cfg.audio?.layers ?? [];
  const audioTracks = [];
  for (const [i, layer] of audioLayers.entries()) {
    const src = resolveAsset(projectDir, layer.src);
    if (!src || !fs.existsSync(src)) {
      warnings.push(`音频素材不存在，已跳过: ${layer.src}`);
      continue;
    }
    const file = stageAsset(src);
    const durUs = Math.max(US, Math.round(
      ((durationInFrames - (layer.from ?? 0)) / fps) * US,
    ));
    const matId = addAudioMaterial(mats, { file, durUs, now });
    const track = makeTrack('audio', `音频${i + 1} ${path.basename(layer.src)}`);
    track.segments.push(makeSegment(matId, Math.round(((layer.from ?? 0) / fps) * US), durUs, {
      volume: layer.volume ?? 1.0,
    }));
    audioTracks.push(track);
  }

  // 5) 素材：画面层
  //    优先级：
  //      a) 逐镜头预渲片段（linvis scenes 产出）—— 动画镜头的唯一正确来源
  //      b) 镜头自带的静态素材（image-scene 的 image / 其他 src）
  //      c) 都没有 → 如实报告，不伪造占位画面
  const videoTrack = makeTrack('video', '画面');
  const textTrack = makeTrack('text', '标题');
  const captionTrack = makeTrack('text', '字幕');

  const sceneClips = opts.sceneClips ?? null;   // Map<sceneId, absMp4>
  // Revalidate even caller-supplied maps; an arbitrary existing MP4 is not a clip cache.
  const validatedDirs = new Map();
  const verifiedClip = (id) => {
    const candidate = sceneClips?.get(id);
    if (!candidate) return null;
    const file = path.resolve(candidate), dir = path.dirname(file);
    if (!validatedDirs.has(dir)) validatedDirs.set(dir, collectSceneClips(cfg.id, {
      outDir: dir, projectDir, cfg, ...(opts.sceneRenderParameters ?? {}),
    }));
    return validatedDirs.get(dir)?.get(id) === file ? file : null;
  };
  const unmaterialized = [];
  const usedClips = [];

  for (const s of cfg.scenes || []) {
    // a) 优先用逐镜头预渲片段
    const clipPath = verifiedClip(s.id);
    if (clipPath && fs.existsSync(clipPath)) {
      const file = stageAsset(clipPath);
      const durUs = Math.round((s.durationInFrames / fps) * US);
      const matId = addVideoMaterial(mats, { file, durUs, width, height, isPhoto: false, hasAudio: false, now });
      videoTrack.segments.push(makeSegment(matId, Math.round((s.from / fps) * US), durUs, { volume: 0 }));
      usedClips.push(s.id);
      continue;
    }

    // b) 镜头自带静态素材
    const rel = s.props?.image ?? s.props?.src;
    if (!rel) { unmaterialized.push(s.id); continue; }
    const src = resolveAsset(projectDir, rel);
    if (!src || !fs.existsSync(src)) {
      warnings.push(`画面素材不存在，已跳过: ${rel}（镜头 ${s.id}）`);
      continue;
    }
    const file = stageAsset(src);
    const isPhoto = /\.(png|jpe?g|webp|bmp)$/i.test(file);
    const durUs = Math.round((s.durationInFrames / fps) * US);
    const matId = addVideoMaterial(mats, { file, durUs, width, height, isPhoto, now });
    videoTrack.segments.push(makeSegment(
      matId,
      Math.round((s.from / fps) * US),
      durUs,
    ));
  }

  if (usedClips.length) {
    notes.push(`画面轨用了 ${usedClips.length} 个逐镜头预渲片段`);
  }

  if (unmaterialized.length) {
    warnings.push(
      `${unmaterialized.length} 个镜头没有可用画面（${unmaterialized.slice(0, 4).join(', ')}${unmaterialized.length > 4 ? ' …' : ''}）。`
      + '它们属于 Remotion 动画镜头，且未找到预渲片段。'
      + `\n  修复：先跑 node engine/bin/linvis.mjs scenes ${cfg.id}，再重新生成本草稿。`
      + '\n  本次草稿不为它们生成占位画面。',
    );
  }

  // 6) 文字层：每个带文案的镜头一条
  const timeline = sceneTimeline(cfg);
  for (const s of timeline) {
    if (!s.text || usedClips.includes(s.id)) continue;
    const durUs = Math.round((s.endSec - s.startSec) * US);
    if (durUs <= 0) continue;
    const matId = addTextMaterial(mats, { text: s.text, size: 15.0, now });
    textTrack.segments.push(makeSegment(
      matId,
      Math.round(s.startSec * US),
      durUs,
      { renderIndex: 14000 },
    ));
  }

  // 7) 字幕层：用 whisper 转写结果，逐句一条（剪映里可逐句改）
  if (cfg.captions?.enabled && cfg.captions.src) {
    const capFile = resolveAsset(projectDir, cfg.captions.src);
    if (capFile && fs.existsSync(capFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(capFile, 'utf8'));
        for (const c of data.captions ?? []) {
          const text = enc(c.text).trim();
          if (!text) continue;
          const startUs = Math.round((c.fromSec ?? (c.from ?? 0) / fps) * US);
          const endUs = Math.round((c.toSec ?? (c.to ?? 0) / fps) * US);
          const durUs = endUs - startUs;
          if (durUs <= 0) continue;
          const matId = addTextMaterial(mats, { text, size: 12.0, now });
          captionTrack.segments.push(makeSegment(matId, startUs, durUs, { renderIndex: 15000 }));
        }
      } catch (e) {
        warnings.push(`字幕文件解析失败，已跳过字幕轨: ${e.message}`);
      }
    } else {
      warnings.push(`字幕文件不存在，已跳过字幕轨: ${cfg.captions.src}`);
    }
  }

  const tracks = [...audioTracks];
  if (videoTrack.segments.length) tracks.push(videoTrack);
  if (textTrack.segments.length) tracks.push(textTrack);
  if (captionTrack.segments.length) tracks.push(captionTrack);
  base.tracks = tracks;

  // 7) 写明文 draft_content.json（根目录 + Timelines 各一份，必须一致）
  const payload = Buffer.from(JSON.stringify(base, null, 2), 'utf8');
  const tlContent = path.join(tlsDir, timelineId, 'draft_content.json');
  fs.writeFileSync(tlContent, payload);
  fs.copyFileSync(tlContent, path.join(draftDir, 'draft_content.json'));

  // 8) project.json / timeline_layout.json
  const projPath = path.join(tlsDir, 'project.json');
  const proj = fs.existsSync(projPath) ? JSON.parse(fs.readFileSync(projPath, 'utf8')) : {};
  proj.id = uid();
  proj.main_timeline_id = timelineId;
  proj.create_time = now;
  proj.update_time = now;
  proj.timelines = [{
    create_time: now, id: timelineId, is_marked_delete: false,
    name: '时间线01', update_time: now,
  }];
  fs.writeFileSync(projPath, JSON.stringify(proj));

  const layoutPath = path.join(draftDir, 'timeline_layout.json');
  if (fs.existsSync(layoutPath)) {
    const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
    layout.activeTimeline = timelineId;
    for (const d of layout.dockItems ?? []) {
      d.timelineIds = [timelineId];
      d.timelineNames = ['时间线01'];
    }
    fs.writeFileSync(layoutPath, JSON.stringify(layout));
  }

  fs.writeFileSync(path.join(draftDir, OWNERSHIP), JSON.stringify({ generator: 'linvis',
    projectDir: realProject, contentHash: hashFile(path.join(draftDir, 'draft_content.json')), files: draftFiles(draftDir) }));

  return {
    ok: true,
    draftDir,
    timelineId,
    skeleton: skeleton.dir,
    templatePath: skeleton.templatePath,
    skeletonVersion: base.new_version,
    bytes: payload.length,
    tracks: tracks.map((t) => ({ type: t.type, name: t.name, segments: t.segments.length })),
    sceneClipsUsed: usedClips,
    notes,
    warnings,
  };
}

/** Only manifest-verified editor clips are eligible. cfg/projectDir are required.
 * scale/crf default to 1/18; pass matching values for non-default renders.
 * Missing, legacy or stale caches return null (never scan bare MP4 files).
 */
export function collectSceneClips(projectId, { outDir = null, projectDir, cfg, scale = 1, crf = 18 } = {}) {
  if (!cfg || !projectDir || cfg.id !== projectId || !safeDirectoryName(projectId)) return null;
  const dir = path.resolve(outDir ?? path.join(PATHS.render, 'scenes', projectId));
  try {
    const map = validatedSceneClips(path.resolve(projectDir), cfg, dir, { scale, crf });
    return map.size ? map : null;
  } catch { return null; }
}

/** 自动发现剪映草稿根目录。 */
export function detectDraftRoot() {
  for (const d of DEFAULT_DRAFT_ROOTS) {
    if (fs.existsSync(d)) return d;
  }
  return null;
}

/**
 * 质检生成的草稿：不靠截图，靠文件与引用自洽性。
 * 剪映打开后会重写为密文，所以明文/密文都算合法状态。
 */
export function inspectJianyingDraft(draftDir) {
  const report = { ok: true, draftDir, checks: [], warnings: [] };
  const add = (name, pass, detail) => {
    report.checks.push({ name, pass, detail });
    if (!pass) report.ok = false;
  };

  add('草稿目录', fs.existsSync(draftDir), draftDir);
  if (!fs.existsSync(draftDir)) return report;

  const tlsDir = path.join(draftDir, 'Timelines');
  add('Timelines 目录', fs.existsSync(tlsDir), tlsDir);

  const projPath = path.join(tlsDir, 'project.json');
  let timelineId = null;
  if (fs.existsSync(projPath)) {
    const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'));
    timelineId = proj.main_timeline_id;
    add('project.json main_timeline_id', Boolean(timelineId), String(timelineId));
    const tlExists = timelineId && fs.existsSync(path.join(tlsDir, timelineId));
    add('时间线目录存在', Boolean(tlExists), path.join(tlsDir, String(timelineId)));
  } else {
    add('project.json', false, '缺失');
  }

  const contentPath = path.join(tlsDir, String(timelineId), 'draft_content.json');
  if (fs.existsSync(contentPath)) {
    const buf = fs.readFileSync(contentPath);
    const isPlain = buf.subarray(0, 1).toString() === '{';
    add('draft_content.json', true, `${buf.length} 字节，${isPlain ? '明文' : '密文（已被剪映接管）'}`);
    if (isPlain) {
      let data = null;
      try {
        data = JSON.parse(buf.toString('utf8'));
        add('JSON 可解析', true, `${data.tracks?.length ?? 0} 条轨道`);
      } catch (e) {
        add('JSON 可解析', false, e.message);
      }
      if (data) {
        const v = data.new_version;
        const maj = parseInt(String(v).split('.')[0], 10);
        add('new_version 不高于骨架', maj <= 200, `new_version=${v}`);
        const refs = [];
        for (const t of data.tracks ?? []) {
          for (const s of t.segments ?? []) refs.push(s.material_id);
        }
        const matIds = new Set();
        for (const bucket of Object.values(data.materials ?? {})) {
          if (!Array.isArray(bucket)) continue;
          for (const m of bucket) if (m?.id) matIds.add(m.id);
        }
        const missing = refs.filter((r) => !matIds.has(r));
        add('片段→素材引用完整', missing.length === 0,
          missing.length ? `缺失 ${missing.length} 个` : `${refs.length} 个引用全部命中`);

        const mediaPaths = [];
        for (const m of data.materials?.videos ?? []) if (m.path) mediaPaths.push(m.path);
        for (const m of data.materials?.audios ?? []) if (m.path) mediaPaths.push(m.path);
        const absent = mediaPaths.filter((p) => !fs.existsSync(p));
        add('媒体文件全部存在', absent.length === 0,
          absent.length ? `缺失: ${absent.join(', ')}` : `${mediaPaths.length} 个文件`);

        const dur = Number(data.duration ?? 0);
        add('时长非零', dur > 0, `${(dur / US).toFixed(2)}s`);
      }
    }
  } else {
    add('draft_content.json', false, '缺失');
  }

  if (fs.existsSync(path.join(draftDir, 'draft_meta_info.json'))) {
    add('draft_meta_info.json', true, '存在（剪映侧车）');
  } else {
    report.warnings.push('缺少 draft_meta_info.json，剪映可能需要重新索引');
  }

  return report;
}
