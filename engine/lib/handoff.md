# Editor handoff API

```js
import { buildHandoff } from './handoff.mjs';

const result = await buildHandoff({
  projectDir, cfg, outDir,
  force: false,
  // Optional. Do not pass guessed MP4 paths.
  sceneClipsDir,
  sceneRenderOptions: { scale: 1, crf: 18 },
});
```

Returns `{ok:true,outDir,manifest,timeline,warnings}`; throws on invalid configuration,
missing materials, existing output without `force`, or unsafe output directories.
The parent CLI should catch errors and apply its normal exit-code/logging contract.
`cfg` and the source project are never modified. Output may not overlap the source
project or repository `projects/`. Existing directories require `force`; force does
not delete unrelated files. Output symlinks/hardlinks are rejected.

Files: `project.json`, `manifest.json`, `timeline.json`, `captions.srt`, and
`assets/<SHA256>.<extension>`. All project assets plus referenced external files are
copied; manifest records SHA256, original sources, licenses and scene references.
Portable `project.json` references (scenes, audio, captions and licenses) are
relative to `assets/`, matching the normal engine contract: `<SHA256>.<extension>`
without an `assets/` prefix. Timeline and manifest references remain relative to
the handoff directory: `assets/<SHA256>.<extension>`.

Timeline uses frames (`video.fps`): scenes have `sceneId`, `from`, `duration`,
`kind`, `src` when available, and `editor:true`. Images/videos remain native.
Animation clips must pass `validatedSceneClips` (render identity, frame range and
file hash); absent/stale clips become explicit `requiresRender` markers, not
invented valid media. Render cache lookup is read-only and optional. Clips are
marked muted. Audio includes exactly `cfg.audio.layers`; discovering a ducked mix
or stem in the asset inventory never inserts it on the timeline.

SRT prefers nonempty `pages`, then `captions`, over retained raw ASR `words`.
Display rows keep their semantic boundaries (short adjacent phrases are not merged).
EP01 `captions-display.json` stores corrected display phrases in `captions` and
original ASR in `words`; the corrected phrases are therefore exported.
Without display rows, words are grouped into short cues; `segments` and bare row
arrays remain supported. Long rows are proportionally split at at most 16 Unicode
code points, favoring punctuation after 12 characters. Rows accept `fromSec/toSec`
or `start/end` seconds, otherwise `from/to` frames at JSON `fps` or project fps.
Invalid times fail rather than generate invalid SRT. No transcription is performed.

FCPXML export and OpenChatCut import are **not implemented/verified** here. Native
images retain source media, not Remotion Ken Burns/overlay effects; unresolved
animation scenes must be rendered before final visual delivery.

## Sidechain API

```js
const result = await duckProjectLayers({
  layers: cfg.audio.layers, assetsDir, output: '/output/mix.wav',
  musicOutput: '/output/ducked-music.wav', // optional default beside output
  duck: { musicGain: 1, voiceGain: 1 }, compare: true, force: false,
});
```

`duckMusic({voice,music,output,musicOutput,duck,compare,force})` is the lower-level
API. Both return `{ok:false,error}` for validation failures. Successful results add
`musicOutput` (music only) alongside `output` (voice + ducked music), with optional
`compare.file` (voice + uncompressed music). Layer wrapper multiplies each layer's
volume by its corresponding duck gain; layer volumes and wrapper gain multipliers
are 0–4, effective gains are 0–16. FFmpeg compressor parameters are range-checked.
Explicit roles take precedence over legacy ID fallback. Relative layer sources are
resolved only against `assetsDir`, not the process working directory. This API
still aligns both input starts at zero and loops music to voice length; it is not
a full frame-offset/fade timeline renderer. For editing, keep original voice and
music-only stem on separate tracks, never add the mixed output alongside voice.

Verification: `node --test engine/tests/*.test.mjs`. Synthetic audio tests require
local FFmpeg/ffprobe; no API calls, global packages or project writes are needed.
