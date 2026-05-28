# Tags + Sheets Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (Phase 1) Save content pillar tags to `assets.tags` in Supabase; (Phase 2) Replace the CSV "Export to Sheets" button with a real push to the Master Content Library Google Sheet.

**Architecture:** Phase 1 adds a second tag pill (Content Pillar) to every asset card in the Media Library — it writes to `assets.tags[]` in Supabase, mirroring how `episode_tag` works today. Phase 2 creates a new Supabase edge function `export-to-sheets` that queries assets + captions + scheduled_posts, maps the data to the 26 Master Content Library columns, and pushes rows via the Composio REST API (Google Sheets already connected with `connected_account_id: ca_Gcgom2gP0x5g`). The Scheduler's "Export to Sheets" button calls this edge function instead of generating a CSV.

**Tech Stack:** React + TypeScript (Vite), Supabase (Postgres + Edge Functions / Deno), Composio REST API (`GOOGLESHEETS_CREATE_SPREADSHEET_ROW`), Tailwind, Sonner (toasts)

**Repo:** `/Users/fabiocorreia/Desktop/blackmagic-app`  
**Supabase project:** `fchdjysbvmucbfxcpcst`  
**Google Sheet ID:** `1X7xRnML2HQkHUx4a9SZzDUMOYkG0tWzFDUFhyu75Pms`  
**Sheet tab:** `Master Content Library`  
**Composio connected account:** `ca_Gcgom2gP0x5g`

---

## Column Mapping Reference

| Sheet Column | Source | Value / Logic |
|---|---|---|
| Content ID | `assets.id` | UUID |
| Project / Episode Name | `assets.episode_tag` | raw tag value |
| Series | `scheduled_posts.platform` (first) | see PLATFORM_TO_SERIES map |
| Content Type | `assets.episode_tag` | see EPISODE_TAG_TO_CONTENT_TYPE map |
| Title | `assets.filename` | strip extension |
| Description | `captions.body` where platform=`x`, else first caption | raw text |
| Shoot Date | — | blank |
| Location | — | blank |
| Talent | — | blank |
| Funnel Stage | `scheduled_posts.platform` (first) | see PLATFORM_TO_FUNNEL map |
| Monetisation Role | — | blank |
| Status | `assets.status` | see ASSET_STATUS map |
| Editor | — | blank |
| File Link (Google Drive) | `assets.file_url` | raw URL |
| Thumbnail Status | — | always `"Done"` |
| Caption Status | — | always `"Written"` |
| Approval Status | `captions.status` = `approved` → "Approved" | else `"Pending"` |
| Ready to Post | `assets.status` = `scheduled` or `published` → "Yes" | else `"No"` |
| Evergreen | — | always `"Yes"` |
| First Post Date | `scheduled_posts.scheduled_at` MIN per asset | formatted `DD/MM/YYYY` |
| Last Post Date | `scheduled_posts.posted_at` MAX per asset | formatted `DD/MM/YYYY` |
| Performance Score | — | blank |
| Notes | — | blank |
| Platform First Posted | `scheduled_posts.platform` (earliest by `scheduled_at`) | raw platform key |
| Content Value | — | blank |
| Repurpose After (Days) | — | blank |

---

## Phase 1: Content Pillar Tags

### Files Modified
- `src/hooks/useFileUpload.ts` — add `tags: string[]` to `UploadedAsset`, add `updateTags` function
- `src/pages/MediaLibrary.tsx` — add `ContentPillarPill` component + render on cards + bulk tag support

---

### Task 1: Add `tags` to the upload hook

**Files:**
- Modify: `src/hooks/useFileUpload.ts`

- [ ] **Step 1: Add `tags` field to `UploadedAsset` interface**

In `src/hooks/useFileUpload.ts`, find the `UploadedAsset` interface (line 8) and add `tags` after `episodeTag`:

```ts
export interface UploadedAsset {
  id: string;
  name: string;
  type: AssetType;
  ratio: AssetRatio;
  duration?: string;
  previewUrl: string;
  fileUrl: string;
  size: number;
  source: 'local' | 'drive';
  status: Asset['status'];
  uploadedAt: string;
  uploadProgress?: number;
  episodeTag: string | null;
  tags: string[];            // ← add this line
}
```

- [ ] **Step 2: Update `dbAssetToUi` to map the tags field**

Find `dbAssetToUi` (line 101) and add `tags` to the returned object:

```ts
function dbAssetToUi(asset: Asset): UploadedAsset {
  return {
    id: asset.id,
    name: asset.filename.replace(/\.[^/.]+$/, ''),
    type: asset.type,
    ratio: asset.ratio,
    duration: asset.duration_secs ? formatDuration(asset.duration_secs) : undefined,
    previewUrl: asset.thumbnail_url ?? '',
    fileUrl: asset.file_url ?? '',
    size: asset.size_bytes ?? 0,
    source: asset.source,
    status: asset.status,
    uploadedAt: asset.uploaded_at,
    episodeTag: asset.episode_tag ?? null,
    tags: asset.tags ?? [],   // ← add this line
  };
}
```

- [ ] **Step 3: Add `updateTags` callback to the hook body**

Find `updateEpisodeTag` (line 317) and add `updateTags` directly after it:

```ts
const updateTags = useCallback(async (id: string, tag: string | null) => {
  const newTags = tag ? [tag] : [];
  setAssets((prev) =>
    prev.map((a) => (a.id === id ? { ...a, tags: newTags } : a))
  );
  await supabase
    .from('assets')
    .update({ tags: newTags })
    .eq('id', id);
}, []);
```

- [ ] **Step 4: Export `updateTags` in the hook's return value**

Find the return statement (line 376) and add `updateTags`:

```ts
return { assets, isLoading, isProcessing, processFiles, removeAsset, removeAssets, updateEpisodeTag, updateTags };
```

- [ ] **Step 5: Run the TypeScript compiler to verify no type errors**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `useFileUpload.ts`

- [ ] **Step 6: Commit**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app
git add src/hooks/useFileUpload.ts
git commit -m "feat: add tags field to UploadedAsset and updateTags hook"
```

---

### Task 2: Add ContentPillarPill to the Media Library

**Files:**
- Modify: `src/pages/MediaLibrary.tsx`

- [ ] **Step 1: Add `CONTENT_PILLARS` constant**

In `src/pages/MediaLibrary.tsx`, find the `CATEGORIES` constant (line 32) and add `CONTENT_PILLARS` directly after it:

```ts
const CONTENT_PILLARS = [
  "Party", "Travel", "Adventure", "BTS", "Lifestyle",
  "Funny", "Explicit", "Romance", "Community", "Education", "Fitness",
];
```

- [ ] **Step 2: Add `ContentPillarPill` component**

Add this component after the closing `}` of `BulkTagPill` (around line 243), before the `// ── Component ─` comment:

```tsx
function ContentPillarPill({
  assetId,
  pillar,
  onUpdate,
}: {
  assetId: string;
  pillar: string | null;
  onUpdate: (id: string, tag: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen((v) => !v);
  };

  const select = (e: React.MouseEvent, value: string | null) => {
    e.stopPropagation();
    onUpdate(assetId, value);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-micro font-satoshi font-medium transition-all backdrop-blur-sm border ${
          pillar
            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
            : "bg-black/40 border-white/10 text-muted-foreground hover:text-foreground"
        }`}
      >
        <span>{pillar ?? "Pillar"}</span>
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropPos.top, right: dropPos.right, zIndex: 9999 }}
          className="w-32 rounded-lg border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-md shadow-xl overflow-hidden"
        >
          {CONTENT_PILLARS.map((p) => (
            <button
              key={p}
              onClick={(e) => select(e, p)}
              className={`w-full text-left px-3 py-1.5 text-micro font-satoshi transition-colors hover:bg-white/[0.06] ${
                pillar === p ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
          {pillar && (
            <>
              <div className="mx-2 my-1 border-t border-white/[0.06]" />
              <button
                onClick={(e) => select(e, null)}
                className="w-full text-left px-3 py-1.5 text-micro font-satoshi text-danger/70 hover:text-danger transition-colors hover:bg-white/[0.06]"
              >
                Clear
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
```

- [ ] **Step 3: Pull `updateTags` from the hook**

Find the destructure of `useFileUpload()` (line 275):

```ts
const { assets, isProcessing, processFiles, removeAssets, updateEpisodeTag } = useFileUpload();
```

Change to:

```ts
const { assets, isProcessing, processFiles, removeAssets, updateEpisodeTag, updateTags } = useFileUpload();
```

- [ ] **Step 4: Render `ContentPillarPill` on each asset card**

Find the `CategoryPill` render block inside the asset grid (around line 649):

```tsx
{/* Category pill — top-right, outside overflow-hidden so dropdown is unclipped */}
<div className="absolute top-2 right-2 z-20">
  <CategoryPill
    assetId={asset.id}
    tag={asset.episodeTag}
    onUpdate={updateEpisodeTag}
  />
</div>
```

Replace with:

```tsx
{/* Tag pills — top-right, outside overflow-hidden so dropdowns are unclipped */}
<div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-1">
  <CategoryPill
    assetId={asset.id}
    tag={asset.episodeTag}
    onUpdate={updateEpisodeTag}
  />
  <ContentPillarPill
    assetId={asset.id}
    pillar={asset.tags[0] ?? null}
    onUpdate={updateTags}
  />
</div>
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 6: Start dev server and visually verify**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app && npm run dev
```

Open `http://localhost:5173/library` in browser. Every asset card should show two pills top-right: the existing purple category pill and a new green "Pillar" pill. Clicking the green pill should open a dropdown with the 11 content pillar options. Selecting one should:
1. Update the pill label immediately (optimistic)
2. Save to `assets.tags` in Supabase (verify in Supabase Table Editor)

- [ ] **Step 7: Commit**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app
git add src/pages/MediaLibrary.tsx
git commit -m "feat: add content pillar tag pill to asset cards"
```

---

## Phase 2: Export to Master Content Library Sheet

### Files Created / Modified
- Create: `supabase/functions/export-to-sheets/index.ts`
- Modify: `src/pages/Scheduler.tsx` (lines 416–444 — `handleExportToSheets` function)

---

### Task 3: Store Composio API key as Supabase secret

- [ ] **Step 1: Extract the Composio API key**

```bash
python3 -c "import json; d=json.load(open('$HOME/.composio/user_data.json')); print(d['api_key'])"
```

Copy the printed key — it will look like `ck_...` or similar. **Do not commit this key.**

- [ ] **Step 2: Store key as Supabase secret**

```bash
supabase secrets set COMPOSIO_API_KEY=<paste-key-here> --project-ref fchdjysbvmucbfxcpcst
```

Expected output: `Finished updating secrets for project fchdjysbvmucbfxcpcst.`

- [ ] **Step 3: Verify the secret is stored**

```bash
supabase secrets list --project-ref fchdjysbvmucbfxcpcst
```

Expected: a row with `COMPOSIO_API_KEY` in the output.

- [ ] **Step 4: Verify Composio sheet tool input schema (needed for Task 4)**

```bash
composio execute "GOOGLESHEETS_CREATE_SPREADSHEET_ROW" --help 2>&1 || \
composio search "append row google sheets" 2>&1 | head -40
```

Note the exact input field names — likely `spreadsheet_id` and either `row_data` or `values`. You will use these in Task 4.

---

### Task 4: Create the `export-to-sheets` edge function

**Files:**
- Create: `supabase/functions/export-to-sheets/index.ts`

- [ ] **Step 1: Create the function file**

Create `/Users/fabiocorreia/Desktop/blackmagic-app/supabase/functions/export-to-sheets/index.ts` with this content:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SPREADSHEET_ID = '1X7xRnML2HQkHUx4a9SZzDUMOYkG0tWzFDUFhyu75Pms'
const COMPOSIO_ACCOUNT_ID = 'ca_Gcgom2gP0x5g'
const COMPOSIO_API = 'https://backend.composio.dev/api/v2/actions/execute'

// ── Mapping tables ────────────────────────────────────────────────────────────

const EPISODE_TAG_TO_CONTENT_TYPE: Record<string, string> = {
  Episode: 'Full Episode',
  Clip: 'Teaser Clip',
  Photo: 'Photo Set',
  Trailer: 'Trailer',
  Teaser: 'Teaser Clip',
}

const PLATFORM_TO_FUNNEL: Record<string, string> = {
  x: 'Traffic',
  telegram_free: 'Free VIP',
  telegram_free_vip: 'Free VIP',
  telegram_vip: 'Paid VIP',
  website: 'Website',
}

const PLATFORM_TO_SERIES: Record<string, string> = {
  x: 'Traffic Content',
  telegram_free: 'Free VIP',
  telegram_free_vip: 'Free VIP',
  telegram_vip: 'VIP Lounge',
  website: 'Website Vault',
}

const ASSET_STATUS_MAP: Record<string, string> = {
  uploaded: 'Filmed',
  processing: 'Filming',
  ready: 'Ready',
  scheduled: 'Scheduled',
  published: 'Posted',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '')
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  const composioApiKey = Deno.env.get('COMPOSIO_API_KEY')
  if (!composioApiKey) {
    return new Response(JSON.stringify({ error: 'COMPOSIO_API_KEY not configured' }), { status: 500 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Fetch all assets
  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select('id, filename, file_url, type, status, episode_tag, tags, thumbnail_url, uploaded_at')
    .order('uploaded_at', { ascending: false })

  if (assetsError) {
    return new Response(JSON.stringify({ error: assetsError.message }), { status: 500 })
  }

  const assetIds = assets.map((a: any) => a.id)

  // 2. Fetch captions for all assets (prefer x, fall back to first)
  const { data: captions } = await supabase
    .from('captions')
    .select('asset_id, platform, body, status')
    .in('asset_id', assetIds)

  // 3. Fetch scheduled posts for all assets
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('asset_id, platform, scheduled_at, posted_at, status')
    .in('asset_id', assetIds)

  // Index by asset_id for quick lookups
  const captionsByAsset: Record<string, any[]> = {}
  for (const c of captions ?? []) {
    if (!captionsByAsset[c.asset_id]) captionsByAsset[c.asset_id] = []
    captionsByAsset[c.asset_id].push(c)
  }

  const postsByAsset: Record<string, any[]> = {}
  for (const p of posts ?? []) {
    if (!postsByAsset[p.asset_id]) postsByAsset[p.asset_id] = []
    postsByAsset[p.asset_id].push(p)
  }

  // 4. Build rows
  const rows: string[][] = []

  for (const asset of assets) {
    const assetCaptions = captionsByAsset[asset.id] ?? []
    const assetPosts = postsByAsset[asset.id] ?? []

    // Caption: prefer x, then first available
    const xCaption = assetCaptions.find((c: any) => c.platform === 'x')
    const description = xCaption?.body ?? assetCaptions[0]?.body ?? ''

    // Approval: approved if any caption is approved
    const anyApproved = assetCaptions.some((c: any) => c.status === 'approved')
    const approvalStatus = anyApproved ? 'Approved' : 'Pending'

    // Platform: earliest scheduled post's platform
    const sortedPosts = [...assetPosts].sort(
      (a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    )
    const firstPost = sortedPosts[0]
    const lastPost = assetPosts.reduce((latest: any, p: any) =>
      !latest || new Date(p.posted_at ?? p.scheduled_at) > new Date(latest.posted_at ?? latest.scheduled_at)
        ? p : latest,
      null as any
    )

    const primaryPlatform = firstPost?.platform ?? ''
    const funnelStage = PLATFORM_TO_FUNNEL[primaryPlatform] ?? ''
    const series = PLATFORM_TO_SERIES[primaryPlatform] ?? ''
    const contentType = EPISODE_TAG_TO_CONTENT_TYPE[asset.episode_tag ?? ''] ?? ''
    const status = ASSET_STATUS_MAP[asset.status] ?? asset.status
    const readyToPost = ['scheduled', 'published'].includes(asset.status) ? 'Yes' : 'No'
    const contentPillar = (asset.tags as string[])?.[0] ?? ''

    rows.push([
      asset.id,                                          // Content ID
      asset.episode_tag ?? '',                           // Project / Episode Name
      series,                                            // Series
      contentType,                                       // Content Type
      stripExt(asset.filename),                          // Title
      description,                                       // Description
      '',                                                // Shoot Date
      '',                                                // Location
      '',                                                // Talent
      funnelStage,                                       // Funnel Stage
      '',                                                // Monetisation Role
      status,                                            // Status
      '',                                                // Editor
      asset.file_url ?? '',                              // File Link (Google Drive)
      'Done',                                            // Thumbnail Status
      'Written',                                         // Caption Status
      approvalStatus,                                    // Approval Status
      readyToPost,                                       // Ready to Post
      'Yes',                                             // Evergreen
      formatDate(firstPost?.scheduled_at ?? null),       // First Post Date
      formatDate(lastPost?.posted_at ?? null),           // Last Post Date
      '',                                                // Performance Score
      '',                                                // Notes
      primaryPlatform,                                   // Platform First Posted
      '',                                                // Content Value
      '',                                                // Repurpose After (Days)
    ])
  }

  // 5. Push each row to Google Sheets via Composio
  let pushed = 0
  const errors: string[] = []

  for (const row of rows) {
    const res = await fetch(COMPOSIO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': composioApiKey,
      },
      body: JSON.stringify({
        action: 'GOOGLESHEETS_CREATE_SPREADSHEET_ROW',
        input: {
          spreadsheet_id: SPREADSHEET_ID,
          // column headers order matches Master Content Library row 1
          values: row,
        },
        connectedAccountId: COMPOSIO_ACCOUNT_ID,
        entityId: 'default',
      }),
    })

    if (res.ok) {
      pushed++
    } else {
      const body = await res.text()
      errors.push(body)
    }

    // Respect Google Sheets rate limit: 60 writes/min = 1 per second
    await new Promise((r) => setTimeout(r, 1100))
  }

  return new Response(
    JSON.stringify({ pushed, errors: errors.slice(0, 3) }),
    { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
  )
})
```

- [ ] **Step 2: Verify the Composio API input format**

Before deploying, test with one row using curl to confirm the exact field names Composio expects for `GOOGLESHEETS_CREATE_SPREADSHEET_ROW`. Run:

```bash
COMPOSIO_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.composio/user_data.json'))['api_key'])")
curl -s -X POST https://backend.composio.dev/api/v2/actions/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: $COMPOSIO_KEY" \
  -d '{
    "action": "GOOGLESHEETS_CREATE_SPREADSHEET_ROW",
    "input": {
      "spreadsheet_id": "1X7xRnML2HQkHUx4a9SZzDUMOYkG0tWzFDUFhyu75Pms",
      "values": ["TEST-ID","","","","Test Row","","","","","","","","","","Done","Written","Pending","No","Yes","","","","","","",""]
    },
    "connectedAccountId": "ca_Gcgom2gP0x5g",
    "entityId": "default"
  }' | python3 -m json.tool
```

If this returns an error about the input shape (e.g., Composio expects a different format like `row_data` as an object), adjust the `input` field in `index.ts` accordingly before proceeding. If it succeeds, delete the test row from the sheet.

- [ ] **Step 3: Deploy the edge function**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app
supabase functions deploy export-to-sheets --no-verify-jwt --project-ref fchdjysbvmucbfxcpcst
```

Expected: `Deployed Function export-to-sheets`

- [ ] **Step 4: Test the edge function end-to-end**

```bash
SUPABASE_ANON=$(grep VITE_SUPABASE_ANON_KEY /Users/fabiocorreia/Desktop/blackmagic-app/.env.local | cut -d= -f2)
curl -s -X POST "https://fchdjysbvmucbfxcpcst.supabase.co/functions/v1/export-to-sheets" \
  -H "Authorization: Bearer $SUPABASE_ANON" \
  -H "Content-Type: application/json"
```

Expected response shape: `{"pushed": N, "errors": []}`. Open the sheet and verify new rows appeared.

- [ ] **Step 5: Commit**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app
git add supabase/functions/export-to-sheets/
git commit -m "feat: add export-to-sheets edge function via Composio"
```

---

### Task 5: Wire "Export to Sheets" button to the edge function

**Files:**
- Modify: `src/pages/Scheduler.tsx` (lines 416–444)

- [ ] **Step 1: Replace `handleExportToSheets` with the edge-function call**

In `src/pages/Scheduler.tsx`, replace the entire `handleExportToSheets` function (lines 416–444):

```ts
async function handleExportToSheets() {
  const anyItems = Object.values(scheduled).some((items) => items.length > 0);
  if (!anyItems) return;

  toast.loading('Exporting to Master Content Library…', { id: 'export' });
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-to-sheets`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? 'Export failed');
    toast.success(`Exported ${result.pushed} rows to Google Sheets`, { id: 'export' });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Export failed', { id: 'export' });
  }
}
```

Note: This exports ALL assets, not just the ones currently visible in the scheduler. This is intentional — the Master Content Library is a full asset registry.

- [ ] **Step 2: Make `handleExportToSheets` async in the JSX**

The button that calls it is around line 668. Verify it calls `onClick={handleExportToSheets}` — the `async` on the function handles the promise, no change needed to the JSX.

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Test end-to-end in browser**

1. Run `npm run dev`
2. Go to `/scheduler`
3. Click "Export to Sheets"
4. Verify "Exporting…" toast appears, then "Exported N rows" success toast
5. Open the Google Sheet and confirm rows were added with correct data

- [ ] **Step 5: Commit + deploy frontend**

```bash
cd /Users/fabiocorreia/Desktop/blackmagic-app
git add src/pages/Scheduler.tsx
git commit -m "feat: wire Export to Sheets button to edge function"
npm run build && npx vercel --prod
```

---

## Notes & Known Gotchas

- **Rate limit:** The edge function sleeps 1.1 seconds between each Composio call to stay under Google Sheets' 60 writes/minute limit. For 200 assets this takes ~4 minutes. This is fine for a manual export. If it becomes too slow, switch to the Google Sheets `values.append` batch API with a service account.

- **Duplicates:** Exporting twice will create duplicate rows. For now this is acceptable. A dedup step (checking if `asset.id` already exists in column A) can be added later.

- **Composio input format:** Step 2 of Task 4 includes a curl test to verify the exact API format. If the format differs from what's in `index.ts`, update the `input` block before deploying. The most likely variation is that Composio expects a named `row_data` object rather than a raw `values` array.

- **`session` variable in Task 5:** The `session` const is fetched but not used in the fetch call (anon key is sufficient for edge function auth). It can be removed after verifying auth works correctly.
