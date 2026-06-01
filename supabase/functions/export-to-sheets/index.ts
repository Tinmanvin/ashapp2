/**
 * export-to-sheets — Pushes newly scheduled/posted content to the
 * "Master Content Library" Google Sheet. Never creates duplicates.
 *
 * Logic:
 *  - Finds assets that have at least one scheduled_post (pending/posting/posted)
 *    AND have never been exported (exported_to_sheet_at IS NULL)
 *  - Builds one row per asset, aggregating all its platform posts
 *  - Appends those rows to the sheet in one batch call
 *  - Marks each exported asset with exported_to_sheet_at = now()
 *
 * ONE-TIME SETUP:
 *  1. Google Cloud Console → enable Google Sheets API
 *  2. Create service account → download JSON key
 *  3. Share the sheet with the service account email (Editor)
 *  4. supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" --project-ref fchdjysbvmucbfxcpcst
 *  5. supabase functions deploy export-to-sheets --no-verify-jwt --project-ref fchdjysbvmucbfxcpcst
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SPREADSHEET_ID = '1X7xRnML2HQkHUx4a9SZzDUMOYkG0tWzFDUFhyu75Pms'
const SHEET_NAME = 'Master Content Library'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

// ── Column mappings ───────────────────────────────────────────────────────────

const EPISODE_TAG_TO_CONTENT_TYPE: Record<string, string> = {
  Episode: 'Full Episode',
  Clip: 'Teaser Clip',
  Photo: 'Photo Set',
  Trailer: 'Trailer',
  Teaser: 'Teaser Clip',
}

const PLATFORM_TO_FUNNEL: Record<string, string> = {
  x: 'Traffic',
  telegram_free: 'BMM Updates',
  telegram_vip: 'BMM VIP Zone',
  website: 'Website',
}

const PLATFORM_TO_SERIES: Record<string, string> = {
  x: 'Traffic Content',
  telegram_free: 'BMM Updates',
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '')
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\n/g, '')
    .trim()
  const binary = atob(b64)
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i))
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    scope: SHEETS_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const encHeader = base64url(new TextEncoder().encode(JSON.stringify(header)))
  const encPayload = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${encHeader}.${encPayload}`
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  )
  const jwt = `${signingInput}.${base64url(signature)}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json()
  return access_token
}

// ── Handler ───────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!saJson) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set. See setup instructions in function source.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Find asset_ids that have scheduled posts (non-failed) but haven't been exported yet
  const { data: posts, error: postsError } = await supabase
    .from('scheduled_posts')
    .select('asset_id, platform, caption, scheduled_at, posted_at, status, group_id, position')
    .in('status', ['pending', 'posting', 'posted'])

  if (postsError) {
    return new Response(
      JSON.stringify({ error: postsError.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  if (!posts?.length) {
    return new Response(
      JSON.stringify({ pushed: 0, message: 'No scheduled posts to export' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  // Group posts by asset_id
  const postsByAsset: Record<string, any[]> = {}
  for (const p of posts) {
    if (!postsByAsset[p.asset_id]) postsByAsset[p.asset_id] = []
    postsByAsset[p.asset_id].push(p)
  }
  const allAssetIds = Object.keys(postsByAsset)

  // 2. Fetch only assets that haven't been exported yet
  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select('id, filename, file_url, type, status, episode_tag, tags, exported_to_sheet_at')
    .in('id', allAssetIds)
    .is('exported_to_sheet_at', null)

  if (assetsError) {
    return new Response(
      JSON.stringify({ error: assetsError.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  if (!assets?.length) {
    return new Response(
      JSON.stringify({ pushed: 0, message: 'All scheduled posts already exported' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  // 2b. Order assets so grouped ones stay adjacent (by group, then position).
  // One row per asset is preserved — we only control row ordering.
  const assetMeta: Record<string, { group_id: string | null; position: number; scheduled_at: string }> = {}
  for (const p of posts) {
    if (!assetMeta[p.asset_id]) {
      assetMeta[p.asset_id] = { group_id: p.group_id ?? null, position: p.position ?? 0, scheduled_at: p.scheduled_at }
    }
  }
  assets.sort((a: any, b: any) => {
    const ma = assetMeta[a.id], mb = assetMeta[b.id]
    const ga = ma?.group_id ?? a.id, gb = mb?.group_id ?? b.id
    if (ga !== gb) {
      const ta = ma?.scheduled_at ?? '', tb = mb?.scheduled_at ?? ''
      if (ta !== tb) return ta < tb ? -1 : 1
      return ga < gb ? -1 : 1
    }
    return (ma?.position ?? 0) - (mb?.position ?? 0)
  })

  // 3. Fetch approved captions for these assets
  const { data: captions } = await supabase
    .from('captions')
    .select('asset_id, platform, body, status')
    .in('asset_id', assets.map((a: any) => a.id))

  const captionsByAsset: Record<string, any[]> = {}
  for (const c of captions ?? []) {
    if (!captionsByAsset[c.asset_id]) captionsByAsset[c.asset_id] = []
    captionsByAsset[c.asset_id].push(c)
  }

  // 4. Build one row per asset
  const rows: string[][] = assets.map((asset: any) => {
    const assetPosts = postsByAsset[asset.id] ?? []
    const assetCaps = captionsByAsset[asset.id] ?? []

    // Caption: prefer X, then Telegram, then first available
    const caption =
      assetPosts.find((p: any) => p.platform === 'x')?.caption ??
      assetCaps.find((c: any) => c.platform === 'x')?.body ??
      assetPosts[0]?.caption ?? ''

    const approvalStatus = assetCaps.some((c: any) => c.status === 'approved') ? 'Approved' : 'Pending'

    // Sort posts by scheduled_at to find first/last
    const sorted = [...assetPosts].sort(
      (a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    )
    const firstPost = sorted[0]
    const lastPosted = assetPosts.reduce((latest: any, p: any) => {
      if (!latest) return p
      const latestTime = new Date(latest.posted_at ?? latest.scheduled_at).getTime()
      const thisTime = new Date(p.posted_at ?? p.scheduled_at).getTime()
      return thisTime > latestTime ? p : latest
    }, null as any)

    const primaryPlatform = firstPost?.platform ?? ''
    const allPlatforms = [...new Set(assetPosts.map((p: any) => p.platform))].join(', ')
    const isPosted = assetPosts.some((p: any) => p.status === 'posted')
    const sheetStatus = isPosted ? 'Posted' : 'Scheduled'

    return [
      asset.id,                                                     // Content ID
      asset.episode_tag ?? '',                                      // Project / Episode Name
      PLATFORM_TO_SERIES[primaryPlatform] ?? '',                   // Series
      EPISODE_TAG_TO_CONTENT_TYPE[asset.episode_tag ?? ''] ?? '',  // Content Type
      stripExt(asset.filename),                                     // Title
      caption,                                                      // Description
      '',                                                           // Shoot Date
      '',                                                           // Location
      '',                                                           // Talent
      PLATFORM_TO_FUNNEL[primaryPlatform] ?? '',                   // Funnel Stage
      '',                                                           // Monetisation Role
      sheetStatus,                                                  // Status
      '',                                                           // Editor
      asset.file_url ?? '',                                         // File Link
      'Done',                                                       // Thumbnail Status
      'Written',                                                    // Caption Status
      approvalStatus,                                               // Approval Status
      isPosted ? 'Yes' : 'No',                                     // Ready to Post
      'Yes',                                                        // Evergreen
      formatDate(firstPost?.scheduled_at),                          // First Post Date
      formatDate(lastPosted?.posted_at),                            // Last Post Date
      '',                                                           // Performance Score
      '',                                                           // Notes
      allPlatforms,                                                 // Platform First Posted
      '',                                                           // Content Value
      '',                                                           // Repurpose After (Days)
    ]
  })

  // 5. Get Google access token
  let accessToken: string
  try {
    accessToken = await getAccessToken(saJson)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  // 6. Find the first empty slot in column A (rows 2-1000) so we always write
  // immediately after the last real data row, ignoring empty formatted rows below.
  const colARes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${SHEET_NAME}!A2:A1000`)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const colAData = await colARes.json()
  const colAValues: string[][] = colAData.values ?? []
  // Trailing empty rows are trimmed by the API, so length = count of data rows
  const nextRow = colAValues.length + 2 // +2: row 1 is header, array is 0-indexed

  const writeRange = encodeURIComponent(`${SHEET_NAME}!A${nextRow}`)
  const sheetsRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${writeRange}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  )

  if (!sheetsRes.ok) {
    const err = await sheetsRes.text()
    return new Response(
      JSON.stringify({ error: `Sheets API error: ${err}` }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  // 7. Mark these assets as exported — prevents future duplicates
  const exportedIds = assets.map((a: any) => a.id)
  await supabase
    .from('assets')
    .update({ exported_to_sheet_at: new Date().toISOString() })
    .in('id', exportedIds)

  const result = await sheetsRes.json()
  const pushed = result.updates?.updatedRows ?? rows.length

  return new Response(
    JSON.stringify({ pushed, total: assets.length }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
})
