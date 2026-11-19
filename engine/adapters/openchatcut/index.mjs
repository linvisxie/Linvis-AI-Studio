/** OpenChatCut public-MCP integration. No editor DB, platform SDK or app patching. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { McpClient } from './client.mjs';

async function connect(options) {
  const c = new McpClient(options);
  await c.initialize();
  return c;
}
async function begin(c, projectId) {
  await c.call('target_project', { projectId });
  const session = await c.call('begin_edit_session', {
    editorProjectId: projectId, clientName: 'Linvis CLI', approvalMode: 'auto', reuseExisting: false,
  });
  if (!session.editSessionId || session.status !== 'drafting') throw new Error('未取得可编辑草稿；未继续修改');
  return session.editSessionId;
}
export async function status(options) {
  const c = await connect(options);
  try { return await c.call('openchatcut_status'); } finally { await c.close(); }
}
async function materialize(c, editSessionId, whole) {
  if (!whole.archived) return whole;
  if (!whole.artifactId) throw new Error('归档缺少 artifactId');
  // Use the documented archive-reader tool. The archive is not an empty timeline.
  let offset = 0, body = '', totalChars = null;
  while (true) {
    const part = await c.call('read_agent_artifact', { editSessionId, artifactId: whole.artifactId, pointer: '', offset, limit: 6000 });
    if (typeof part.content !== 'string' || part.offset !== offset || part.bodySha256 !== whole.bodySha256 || part.redacted || part.binaryOmitted || part.totalChars > 8388608) throw new Error('归档时间线不完整或身份不符；未继续提交');
    if (totalChars === null) totalChars = part.totalChars;
    if (!Number.isSafeInteger(totalChars) || totalChars < 0 || part.totalChars !== totalChars || body.length + part.content.length > Math.min(totalChars, 8388608)) throw new Error('归档总长度异常');
    body += part.content;
    if (!part.hasMore) {
      assert.equal(body.length, part.totalChars, '归档时间线长度');
      break;
    }
    if (part.nextOffset !== offset + part.content.length) throw new Error('归档分页不连续');
    offset = part.nextOffset;
  }
  assert.equal(createHash('sha256').update(body).digest('hex'), whole.bodySha256, '归档内容哈希');
  return JSON.parse(body);
}
export async function readSnapshot(c, editSessionId, timelineId) {
  const project = await materialize(c, editSessionId, await c.call('read_project', { editSessionId, view: 'timeline', ...(timelineId ? { timelineId } : {}) }));
  if (!project.timeline) throw new Error('时间线读取未返回 timeline');
  return project;
}
export async function inspectProject(projectId, options, timelineId) {
  if (!projectId) throw new Error('--editor-project 必填');
  const c = await connect(options);
  let editSessionId;
  try {
    editSessionId = await begin(c, projectId);
    const project = await readSnapshot(c, editSessionId, timelineId);
    await c.call('discard_edit_session', { editSessionId });
    editSessionId = null;
    return { ok: true, ...project };
  } finally {
    if (editSessionId) await c.call('discard_edit_session', { editSessionId }).catch(() => {});
    await c.close();
  }
}

/** Reproduce commit lifecycle on an isolated scratch project, never a user timeline. */
export async function selfTest(options) {
  const c = await connect(options);
  let projectId;
  const receipt = { ok: false, rounds: [], sameTransportAfterCommit: null };
  try {
    const project = await c.call('create_project', {
      name: `Linvis MCP lifecycle check ${new Date().toISOString()}`,
      compositionWidth: 1080, compositionHeight: 1920, fps: 30,
    });
    projectId = project.projectId ?? project.id ?? project.project?.id;
    if (!projectId) throw new Error('新建测试工程未返回 projectId');
    receipt.projectId = projectId;
    const sid = await begin(c, projectId);
    await c.call('edit_item', { editSessionId: sid, adds: [
      { type: 'solid', name: 'Linvis lifecycle round 1', color: '#182028', track: 'V1', fromFrame: 0, durationInFrames: 120 },
    ] });
    const commit = await c.call('review_edit_session', { editSessionId: sid, summary: 'Linvis 本机 MCP 第一轮保存验证' });
    assert.equal(commit.status, 'applied', '第一轮未确认保存，不重放修改');
    receipt.rounds.push({ round: 1, status: commit.status });
    // A failed begin changes no timeline. Record the server limitation without replaying a commit.
    try {
      const next = await c.call('begin_edit_session', { approvalMode: 'auto', clientName: 'Linvis lifecycle same-transport check' });
      receipt.sameTransportAfterCommit = { outcome: next.status ?? next.outcome };
      if (next.editSessionId) await c.call('discard_edit_session', { editSessionId: next.editSessionId });
    } catch (e) { receipt.sameTransportAfterCommit = { error: e.message }; }
  } finally { await c.close(); }
  // A transaction starts with a fresh initialized transport; do not reuse stale bindings.
  const c2 = await connect(options);
  try {
    const sid = await begin(c2, projectId);
    const before = await c2.call('read_project', { editSessionId: sid, view: 'timeline' });
    assert.equal(before.timeline.items.length, 1, '第一轮持久化回读不符');
    await c2.call('edit_item', { editSessionId: sid, adds: [
      { type: 'solid', name: 'Linvis lifecycle round 2', color: '#283848', track: 'V1', fromFrame: 120, durationInFrames: 60 },
    ] });
    const commit = await c2.call('review_edit_session', { editSessionId: sid, summary: 'Linvis 本机 MCP 第二轮保存验证' });
    assert.equal(commit.status, 'applied', '第二轮未确认保存，不重放修改');
    receipt.rounds.push({ round: 2, status: commit.status });
  } finally { await c2.close(); }
  const persisted = await inspectProject(projectId, options);
  assert.equal(persisted.timeline.items.length, 2, '第二轮持久化回读不符');
  assert.deepEqual(persisted.timeline.items.map((x) => [x.fromFrame ?? x.startFrame, x.durationInFrames]).sort((a, b) => a[0] - b[0]), [[0, 120], [120, 60]]);
  return { ...receipt, ok: true, freshTransportPersistence: true, persistedItems: 2 };
}

export function srtPages(text, fps) {
  const ms = (s) => {
    const m = s.match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/);
    if (!m) throw new Error('无效 SRT 时间');
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
  };
  return text.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map((block) => {
    const lines = block.split(/\r?\n/);
    const i = lines.findIndex((x) => x.includes(' --> '));
    if (i < 0) throw new Error('无效 SRT 字幕');
    const [a, b] = lines[i].split(' --> ');
    const fromFrame = Math.round(ms(a.trim()) * fps), end = Math.round(ms(b.trim()) * fps);
    if (end <= fromFrame) throw new Error('无效字幕时长');
    return { text: lines.slice(i + 1).join('\n'), fromFrame, durationInFrames: end - fromFrame };
  });
}

export function readPackage(packageDir) {
  packageDir = fs.realpathSync(packageDir);
  const timeline = JSON.parse(fs.readFileSync(path.join(packageDir, 'timeline.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
  if (!timeline.scenes.length || timeline.scenes.some((s) => s.kind !== 'clip' || !s.validated || !s.muted)) throw new Error('OpenChatCut 接入要求全部镜头为已验证的静音 editor 片段；先运行 scenes + handoff');
  const safeFile = (src) => {
    const file = path.resolve(packageDir, src);
    if (!file.startsWith(packageDir + path.sep)) throw new Error('交接素材越界');
    const asset = manifest.assets.find((x) => x.path === src);
    if (!asset || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== asset.sha256) throw new Error(`交接素材校验失败: ${src}`);
    return file;
  };
  const paths = [...new Set([...timeline.scenes.map((s) => s.src), ...timeline.audio.map((l) => l.src)])].map(safeFile);
  const captions = timeline.captions?.enabled ? srtPages(fs.readFileSync(path.join(packageDir, 'captions.srt'), 'utf8'), timeline.video.fps) : [];
  return { packageDir, timeline, manifest, paths, captions };
}

export function mapPoolSources(pkg, pool) {
  const assets = pool.mediaPool?.assets ?? (Array.isArray(pool.assets) ? pool.assets : pool.assets?.assets);
  if (!Array.isArray(assets)) throw new Error('无法读取媒体池');
  const assetFor = (src) => {
    const matches = assets.filter((a) => a.name === path.basename(src));
    if (matches.length !== 1 || matches[0].offline) throw new Error(`素材无法唯一匹配或已离线: ${path.basename(src)}`);
    return matches[0];
  };
  const assetId = (src) => assetFor(src).id;
  pkg.assetIds = Object.fromEntries([...pkg.timeline.scenes, ...pkg.timeline.audio].map((x) => [x.src, assetId(x.src)]));
  pkg.audioFrames = Object.fromEntries(pkg.timeline.audio.map((layer) => {
    const available = assetFor(layer.src).durationInFrames;
    if (!Number.isSafeInteger(available) || available <= 0) throw new Error(`音频源帧数不可用: ${layer.id}`);
    const duration = Math.min(available, pkg.timeline.video.durationInFrames - layer.from);
    if (duration <= 0) throw new Error(`音频越界: ${layer.id}`);
    return [layer.id, duration];
  }));
  return assetId;
}
export async function verifyPackage({ packageDir, projectId, clientOptions, timelineId }) {
  const pkg = readPackage(packageDir), c = await connect(clientOptions);
  let sid;
  try {
    sid = await begin(c, projectId);
    const project = await readSnapshot(c, sid, timelineId);
    mapPoolSources(pkg, await materialize(c, sid, await c.call('read_project', { editSessionId: sid, view: 'assets' })));
    const verification = validateTimeline(project, pkg);
    return { ok: true, projectId, timelineId: project.timeline.id, assetIds: pkg.assetIds, audioFrames: pkg.audioFrames, verification };
  } finally {
    if (sid) await c.call('discard_edit_session', { editSessionId: sid }).catch(() => {});
    await c.close();
  }
}

/** Safe append as a NEW timeline. Never clears or overwrites an existing sequence. */
export async function pushPackage({ packageDir, projectId, name, clientOptions, onReceipt }) {
  if (!projectId || !name) throw new Error('--editor-project 和 --name 必填');
  const pkg = readPackage(packageDir);
  const c = await connect(clientOptions);
  let sid, committed = false, commitStarted = false;
  const receipt = { ok: false, projectId, timelineName: name, editorUrl: null, commit: null };
  const save = () => onReceipt?.(structuredClone(receipt));
  try {
    sid = await begin(c, projectId);
    const initial = await readSnapshot(c, sid);
    if (initial.timelines.some((t) => t.name === name)) throw new Error('同名时间线已存在：为避免重复导入，本次未修改；请 inspect 或明确选择新名称');
    const created = await c.call('manage_timelines', { editSessionId: sid, action: 'create', name, width: pkg.timeline.video.width, height: pkg.timeline.video.height });
    receipt.createdTimeline = created;
    save();
    await c.call('import_assets', { editSessionId: sid, paths: pkg.paths });
    const pool = await materialize(c, sid, await c.call('read_project', { editSessionId: sid, view: 'assets' }));
    const assetId = mapPoolSources(pkg, pool);
    receipt.assetIds = pkg.assetIds;
    receipt.audioFrames = pkg.audioFrames;
    save();
    for (const layer of pkg.timeline.audio) await c.call('edit_track', { editSessionId: sid, action: 'create', json: JSON.stringify({ trackType: 'audio', name: layer.role === 'voice' ? '真人配音' : '独立音乐' }) });
    if (pkg.captions.length) await c.call('edit_track', { editSessionId: sid, action: 'create', json: JSON.stringify({ trackType: 'video', name: '中文字幕（逐句文字可编辑）' }) });
    const adds = pkg.timeline.scenes.map((s) => ({ type: 'video', assetId: assetId(s.src), track: 'V1', fromFrame: s.from, durationInFrames: s.durationInFrames }));
    // Pool audio is bounded by actual decoded duration; never request 42s from a 41.68s source.
    for (const [i, layer] of pkg.timeline.audio.entries()) adds.push({ type: 'audio', assetId: assetId(layer.src), track: `A${i + 1}`, fromFrame: layer.from, durationInFrames: pkg.audioFrames[layer.id] });
    for (const [i, row] of pkg.captions.entries()) adds.push({ type: 'text', track: 'V2', name: `字幕 ${String(i + 1).padStart(2, '0')}`, text: row.text, fromFrame: row.fromFrame, durationInFrames: row.durationInFrames, fontSize: 52, fontWeight: 700, color: '#f2eee6', align: 'center' });
    await c.call('edit_item', { editSessionId: sid, adds });
    let draft = await readSnapshot(c, sid);
    if (!draft.timeline) {
      receipt.readResponse = draft; save();
      throw new Error('时间线读取返回归档或非预期结构；草稿未提交，检查操作回执');
    }
    const items = draft.timeline.items;
    const updates = items.filter((x) => x.kind === 'text' || x.type === 'text').map((x) => ({ type: 'text', itemId: x.id, transform: { y: 30 } }));
    for (const [i, layer] of pkg.timeline.audio.entries()) {
      const track = draft.timeline.tracks.find((t) => t.alias === `A${i + 1}`);
      const item = items.find((x) => x.kind === 'audio' && (x.trackId === track?.id || x.track === track?.id));
      if (!item) throw new Error(`音频轨未回读命中: A${i + 1}`);
      updates.push({ type: 'audio', itemId: item.id, volume: layer.volume ?? 1,
        fadeInSeconds: (layer.fadeInFrames ?? 0) / pkg.timeline.video.fps,
        fadeOutSeconds: (layer.fadeOutFrames ?? 0) / pkg.timeline.video.fps });
    }
    if (updates.length) await c.call('edit_item', { editSessionId: sid, updates });
    draft = await readSnapshot(c, sid);
    receipt.draft = validateTimeline(draft, pkg);
    receipt.timelineId = draft.timeline.id;
    save();
    commitStarted = true;
    const commit = await c.call('review_edit_session', { editSessionId: sid, summary: `Linvis：${pkg.timeline.scenes.length} 个静音镜头、${pkg.timeline.audio.length} 条独立音轨、${pkg.captions.length} 条可编辑字幕文字` });
    receipt.commit = commit;
    receipt.editorUrl = commit.editorUrl;
    committed = commit.status === 'applied';
    if (!committed) throw new Error('提交未返回 applied；不自动重放');
    save();
  } catch (e) {
    receipt.error = e.message;
    receipt.outcome = committed ? 'committed-verification-incomplete' : commitStarted ? 'commit-outcome-unknown-do-not-replay' : 'draft-not-committed';
    if (sid && !commitStarted) await c.call('discard_edit_session', { editSessionId: sid }).catch(() => {});
    save();
    throw e;
  } finally { await c.close(); }
  // Fresh authorized transport is mandatory: never mutate/rebase a stale server session.
  try {
    const persisted = await inspectProject(projectId, clientOptions);
    assert.equal(persisted.timeline.id, receipt.timelineId, '提交后活动时间线不符');
    receipt.persisted = validateTimeline(persisted, pkg);
    receipt.ok = true;
    receipt.outcome = 'applied-and-read-back-on-new-transport';
    save();
    return receipt;
  } catch (e) {
    receipt.outcome = 'committed-verification-incomplete-do-not-replay';
    receipt.error = e.message;
    save();
    throw e;
  }
}

export function validateTimeline(project, pkg) {
  const tl = project.timeline;
  assert.equal(tl.fps, pkg.timeline.video.fps);
  assert.equal(tl.width, pkg.timeline.video.width);
  assert.equal(tl.height, pkg.timeline.video.height);
  const kind = (x) => x.kind ?? x.type;
  const byKind = (k) => tl.items.filter((x) => kind(x) === k).sort((a, b) => (a.fromFrame ?? a.startFrame) - (b.fromFrame ?? b.startFrame));
  const video = byKind('video'), audio = byKind('audio'), text = byKind('text');
  assert.equal(tl.items.length, video.length + audio.length + text.length, '意外的额外片段');
  const trackFor = (alias) => tl.tracks.find((t) => t.alias === alias)?.id;
  const checkSource = (item, src) => {
    assert.equal(item.name, path.basename(src), '素材名称/内容哈希引用');
    assert.equal(item.linkStatus, 'linked', '素材掉链');
    assert.equal(item.sourceStartFrame, 0, '源起点');
    assert.equal(item.sourceDurationInFrames, item.durationInFrames, '源窗口时长');
    if (pkg.assetIds) {
      assert.equal(item.sourceAssetId, pkg.assetIds[src], '素材池 id');
      assert.equal(item.resolvedSourceAssetId, pkg.assetIds[src], '实际解析素材 id');
    }
  };
  for (const item of tl.items) {
    const start = item.fromFrame ?? item.startFrame;
    assert.ok(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(item.durationInFrames) && item.durationInFrames > 0 && start + item.durationInFrames <= pkg.timeline.video.durationInFrames, '片段越界或无效时长');
  }
  assert.equal(video.length, pkg.timeline.scenes.length, '镜头数');
  assert.equal(audio.length, pkg.timeline.audio.length, '独立音轨数');
  assert.equal(text.length, pkg.captions.length, '可编辑字幕数');
  for (const [i, item] of video.entries()) {
    assert.equal(item.fromFrame ?? item.startFrame, pkg.timeline.scenes[i].from, `镜头 ${i} 起点`);
    assert.equal(item.durationInFrames, pkg.timeline.scenes[i].durationInFrames, `镜头 ${i} 帧数`);
    assert.equal(item.trackId, trackFor('V1'), `镜头 ${i} 轨道`);
    checkSource(item, pkg.timeline.scenes[i].src);
  }
  for (const [i, layer] of pkg.timeline.audio.entries()) {
    const trackId = trackFor(`A${i + 1}`);
    const item = audio.find((x) => x.trackId === trackId);
    assert.ok(item, `独立音轨 A${i + 1}`);
    checkSource(item, layer.src);
    assert.equal(item.fromFrame ?? item.startFrame, layer.from, '音轨起点');
    if (pkg.audioFrames) assert.equal(item.durationInFrames, pkg.audioFrames[layer.id], '音轨源长度/工程末尾裁切');
    assert.equal(item.volume, layer.volume ?? 1, '音轨增益');
    assert.equal(item.fadeInFrames ?? 0, layer.fadeInFrames ?? 0, '音轨淡入');
    assert.equal(item.fadeOutFrames ?? 0, layer.fadeOutFrames ?? 0, '音轨淡出');
  }
  for (const [i, item] of text.entries()) {
    assert.equal(item.fromFrame ?? item.startFrame, pkg.captions[i].fromFrame);
    assert.equal(item.durationInFrames, pkg.captions[i].durationInFrames);
    assert.equal(item.props?.text ?? item.text, pkg.captions[i].text, `字幕 ${i} 文本`);
    assert.equal(item.trackId, trackFor('V2'), '字幕轨');
    assert.equal(item.transform?.y, 30, '字幕纵向安全区');
    assert.equal(item.props?.fontSize, 52, '字幕字号');
  }
  const durationInFrames = Math.max(...tl.items.map((x) => (x.fromFrame ?? x.startFrame) + x.durationInFrames));
  assert.equal(durationInFrames, pkg.timeline.video.durationInFrames, '工程最终时长');
  return { videoClips: video.length, audioClips: audio.length, editableTextCaptions: text.length, durationInFrames, tracks: tl.tracks.map((t) => ({ id: t.id, alias: t.alias, name: t.name })) };
}
