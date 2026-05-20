/**
 * export-to-sheets — Pushes all assets from Supabase to the
 * "Master Content Library" Google Sheet using a service account.
 *
 * ONE-TIME SETUP (takes ~5 minutes):
 * ─────────────────────────────────
 * 1. Go to https://console.cloud.google.com
 * 2. Create a new project (or reuse an existing one)
 * 3. Enable the Google Sheets API:
 *    APIs & Services → Library → search "Google Sheets API" → Enable
 * 4. Create a service account:
 *    APIs & Services → Credentials → Create Credentials → Service Account
 *    Name it anything (e.g. "ash-sheets-writer"), skip role assignment, click Done
 * 5. Create a JSON key for the service account:
 *    Click the service account → Keys tab → Add Key → Create new key → JSON
 *    Download the key file (e.g. key.json)
 * 6. Share the Google Sheet with the service account email
 *    (it's in the JSON as "client_email", looks like xxx@project.iam.gserviceaccount.com)
 *    Open the sheet → Share → paste the email → set to Editor → Send
 * 7. Store the key as a Supabase secret (run from terminal):
 *    supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" --project-ref fchdjysbvmucbfxcpcst
 * 8. Deploy this function:
 *    supabase functions deploy export-to-sheets --no-verify-jwt --project-ref fchdjysbvmucbfxcpcst
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
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
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

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Token exchange failed: ${err}`)
  }

  const { access_token } = await tokenRes.json()
  return access_token
}

// ── Handler ───────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const saJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!saJson) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_SERVICE_ACCOUNT_JSON secret not set. See setup instructions in the function source.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Fetch all assets
  const { data: assets, error: assetsError } = await supabase
    .from('assets')
    .select('id, filename, file_url, type, status, episode_tag, tags, uploaded_at')
    .order('uploaded_at', { ascending: false })

  if (assetsError || !assets) {
    return new Response(
      JSON.stringify({ error: assetsError?.message ?? 'No assets found' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const assetIds = assets.map((a: any) => a.id)

  // 2. Fetch captions + scheduled posts in parallel
  const [captionsRes, postsRes] = await Promise.all([
    supabase
      .from('captions')
      .select('asset_id, platform, body, status')
      .in('asset_id', assetIds),
    supabase
      .from('scheduled_posts')
      .select('asset_id, platform, scheduled_at, posted_at, status')
      .in('asset_id', assetIds),
  ])

  // Index by asset_id
  const captionsByAsset: Record<string, any[]> = {}
  for (const c of captionsRes.data ?? []) {
    if (!captionsByAsset[c.asset_id]) captionsByAsset[c.asset_id] = []
    captionsByAsset[c.asset_id].push(c)
  }

  const postsByAsset: Record<string, any[]> = {}
  for (const p of postsRes.data ?? []) {
    if (!postsByAsset[p.asset_id]) postsByAsset[p.asset_id] = []
    postsByAsset[p.asset_id].push(p)
  }

  // 3. Build rows — one per asset, 26 columns matching Master Content Library
  const rows: string[][] = assets.map((asset: any) => {
    const caps = captionsByAsset[asset.id] ?? []
    const posts = postsByAsset[asset.id] ?? []

    const xCaption = caps.find((c: any) => c.platform === 'x')
    const description = xCaption?.body ?? caps[0]?.body ?? ''
    const approvalStatus = caps.some((c: any) => c.status === 'approved') ? 'Approved' : 'Pending'

    const sorted = [...posts].sort(
      (a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
    )
    const firstPost = sorted[0]
    const lastPosted = posts.reduce((latest: any, p: any) => {
      if (!latest) return p
      return new Date(p.posted_at ?? p.scheduled_at) > new Date(latest.posted_at ?? latest.scheduled_at)
        ? p : latest
    }, null as any)

    const primaryPlatform = firstPost?.platform ?? ''

    return [
      asset.id,                                                      // Content ID
      asset.episode_tag ?? '',                                       // Project / Episode Name
      PLATFORM_TO_SERIES[primaryPlatform] ?? '',                    // Series
      EPISODE_TAG_TO_CONTENT_TYPE[asset.episode_tag ?? ''] ?? '',   // Content Type
      stripExt(asset.filename),                                      // Title
      description,                                                   // Description
      '',                                                            // Shoot Date
      '',                                                            // Location
      '',                                                            // Talent
      PLATFORM_TO_FUNNEL[primaryPlatform] ?? '',                    // Funnel Stage
      '',                                                            // Monetisation Role
      ASSET_STATUS_MAP[asset.status] ?? asset.status,               // Status
      '',                                                            // Editor
      asset.file_url ?? '',                                          // File Link
      'Done',                                                        // Thumbnail Status
      'Written',                                                     // Caption Status
      approvalStatus,                                                // Approval Status
      ['scheduled', 'published'].includes(asset.status) ? 'Yes' : 'No', // Ready to Post
      'Yes',                                                         // Evergreen
      formatDate(firstPost?.scheduled_at),                           // First Post Date
      formatDate(lastPosted?.posted_at),                             // Last Post Date
      '',                                                            // Performance Score
      '',                                                            // Notes
      primaryPlatform,                                               // Platform First Posted
      '',                                                            // Content Value
      '',                                                            // Repurpose After (Days)
    ]
  })

  // 4. Get Google access token
  let accessToken: string
  try {
    accessToken = await getAccessToken(saJson)
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  // 5. Append all rows in one batch call
  const range = encodeURIComponent(`${SHEET_NAME}!A:Z`)
  const sheetsRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
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

  const result = await sheetsRes.json()
  const pushed = result.updates?.updatedRows ?? rows.length

  return new Response(
    JSON.stringify({ pushed, total: assets.length }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
})
