# Group Posting — Master Execution Plan

> **STATUS (2026-06-01):** All 15 steps IMPLEMENTED on branch `feat/group-posting`.
> Frontend build ✅ + `tsc --noEmit` ✅ (zero errors). DB migration APPLIED to live
> (additive, backwards-compatible). **NOT yet deployed** to Vercel or Supabase edge
> functions — awaiting test + go-ahead. Edge fns are backwards-compatible with the
> current live frontend, so deploying them alone is safe.
> Known scope notes: Website in a group posts the COVER asset only (Post Now) / each
> asset as its own vault entry (cron) — website is a single-item funnel, not an album.
> Pre-existing security item to address separately: `compression_jobs` has RLS disabled.


**Goal:** Let Ash select multiple assets in the Library, pick Telegram and/or X, and have them post as ONE native group (Telegram album / X multi-image tweet) — exactly as if posting from a phone. The app never restructures the layout; it hands the group to the platform and lets the platform arrange it.

**Core principle:** Every post is a "group of N." Single post = group of 1. ONE code path, keyed off `assets.length`. No toggle — the pipeline run IS the grouping.

---

## Platform rules (the source of truth for validation)

| Scenario | Limit |
|---|---|
| Telegram, multi | 2–10 items, photos + videos may mix |
| X, multi | **images only, max 4** (X cannot do multiple videos or mix video+images) |
| X, single video | 1 video — fine (this is a group of 1, not multi) |
| Telegram + X both selected, multi | X's stricter rule wins: images only, max 4 |
| Caption | One caption per platform per group. On Telegram it sits on the **first item (index 0)** only. |

**Validation = block-at-selection, live.** Only halt on a real violation. Show a short "what + fix" message:
- X multi with a video → "X can't mix video and images in one post, and allows max 4. Remove the video and keep 4 images max."
- X multi >4 images → "X allows max 4 images per post. Deselect [N] to continue."
- Telegram multi >10 → "Telegram allows max 10 per album. Deselect [N]."
- Telegram + X both, breaking X rule → name the X limit.

---

## Execution steps (in order)

### 1. DB migration — `scheduled_posts` (KEYSTONE)
Add two columns (additive, backwards-compatible):
- `group_id uuid` — every asset in the same post shares it
- `position int default 0` — preserves selection order within the group

Existing rows: backfill `group_id = gen_random_uuid()` per existing (asset_id, scheduled_at) so each old single becomes a group of 1.

### 2. Data model — `src/store/schedulerStore.ts`
- `ScheduledAsset.asset: UploadedAsset` → `assets: UploadedAsset[]`.
- Add `groupId: string` to `ScheduledAsset`.
- Update `mergeApprovedQueue` dedup key, `scheduleItem`, `unscheduleItem`, `deleteConfirmedItem`, `confirmSchedule`, `loadConfirmedSchedule` to operate on `assets[0].id`/`groupId` instead of `asset.id`.
- Update every consumer of `item.asset` across the app to `item.assets`.

### 3. MediaLibrary — `src/pages/MediaLibrary.tsx`
- Selection order already preserved (`selected` is an insertion-ordered array). Keep it.
- Add live validation in `handleProcess` (and surface inline before Process is clickable): run the rule matrix above against `selected` + `activePlatforms`. On violation, block + toast the short message. Otherwise proceed.
- `setProcessingJob` carries the ordered asset list (group) forward unchanged.

### 4. Processing + captions
- When `assets.length > 1`, generate ONE caption per platform for the group, analysing the **first image only** (for now).
- Store/keep captions keyed per platform at the group level (not per asset).

### 5. PreviewView — `src/pages/PreviewView.tsx`
- Add group render mode (when `assets.length > 1`):
  - **Telegram tab:** native album collage (mimic Telegram's layout for the item count).
  - **X tab:** native X multi-image layout — 2 = side-by-side, 3 = 1 large + 2 stacked, 4 = 2x2.
  - No crossover: each tab shows only its own platform's layout.
- Single-asset preview path stays exactly as-is.
- "Schedule Approved" builds ONE `ScheduledAsset` carrying the ordered `assets[]` + one `groupId` + per-platform group captions.

### 6. `post-telegram` edge fn — `supabase/functions/post-telegram/index.ts`
- Accept an optional ordered `items[]` (fileUrl, fileType, width/height/duration per video).
- 1 item → existing `sendPhoto`/`sendVideo` (untouched).
- 2+ items → `sendMediaGroup`: build the `media` JSON array with `attach://` refs, attach each blob as a multipart field, caption on **index 0 only**, preserve per-video width/height/duration (keeps the stretching fix).
- Stays backwards-compatible.

### 7. `post-x` edge fn + `src/lib/xPoster.ts`
- xPoster: for a group, compress each oversized image → upload each to get a `media_id` → pass ordered `media_ids[]`.
- post-x edge fn: upload each media, collect IDs, create ONE tweet attaching all IDs (max 4). Single path untouched.

### 8. `telegramPoster.ts` (Post Now) — `src/lib/telegramPoster.ts`
- Group path: compress videos **sequentially** (FFmpeg singleton), upload all to temp R2, call post-telegram with ordered `items[]`, delete temp files after.
- Route X group through xPoster, website unchanged.
- Per-platform result reporting as today (group is atomic per platform).

### 9. `run-scheduled-posts` cron — `supabase/functions/run-scheduled-posts/index.ts`
- Fetch due rows, then **group by `group_id + platform`**, order by `position`.
- 1 row in group → single send (as today). 2+ → `sendMediaGroup` / multi-image tweet.
- Mark every row in the group with the group's result (all posted / all failed — atomic per platform).

### 10. Scheduler — `src/pages/Scheduler.tsx`
- `handlePublishOnSchedule`: write one row per (asset × platform) BUT stamp shared `group_id` + `position` per group.
- `loadConfirmedSchedule` reconstruction: group rows by `group_id` (not `asset_id`), rebuild `assets[]` ordered by `position`.
- `handleDeleteConfirmed`: delete by `group_id` (whole album removed as one).
- Calendar cell + QueueCard: when group, show a stacked-thumbnail look + count badge.
- `backgroundCompressor`: compress each video in the group sequentially, update the matching rows.

### 11. Google Sheets export — `supabase/functions/export-to-sheets/index.ts`
- Keep **1 row per asset** (not merged).
- Order export so all assets sharing a `group_id` are **adjacent** (sort by group_id + position).
- Mark all assets in the group `exported_to_sheet_at` so nothing duplicates.

---

## Done = verified
- [ ] Single posts still work unchanged (image + video, all platforms).
- [ ] 3-photo album → Telegram: one native collage, caption on first item.
- [ ] 4-photo group → X: one tweet, native 2x2.
- [ ] Telegram + X multi: X cap enforced at selection with clear message.
- [ ] Scheduled group fires as ONE album via cron (not N separate posts).
- [ ] Delete removes the whole group.
- [ ] Sheets: 1 row per asset, group assets adjacent, no duplicates.
- [ ] Portrait video stretching fix preserved inside groups.
