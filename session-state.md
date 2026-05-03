# Session State — Blackmagic App
Last updated: 2026-05-01

## Current Status
Telegram preview card — still iterating. Latest commit pushed to prod: `e39ee4f`
Vercel deploy triggered ~21:35 local time. **Fabio needs to verify this visually on ashapp.atlasai-agents.com before anything else.**

## What We're Fixing
File: `src/pages/PreviewView.tsx`
Components: `MediaBlock` (telegram branch) + `TelegramPost`
**DO NOT touch X preview — that is working and should not be changed.**

## Fabio's Spec (non-negotiable)
1. Whole card (image + caption + reactions) fits on screen without scrolling — always
2. Rounded corners on the image — always, no exceptions
3. Image preserves aspect ratio — no crop, no distortion, no squishing
4. Image fills the card width — not floating small inside a wide bubble
5. If image is very tall (extreme portrait), scale it down proportionally so card fits on screen

## Current Implementation (commit e39ee4f)
**Bubble (TelegramPost):**
- Fixed `width: 320px`, `maxWidth: calc(100% - 2rem)`
- `overflow-hidden` + `rounded-2xl` — corners clipped by parent (clean approach)

**Image (MediaBlock telegram branch):**
- `width: 100%` — fills full bubble width
- `height: auto`, `maxHeight: 55vh` — proportional, capped
- `objectFit: cover` — fills frame, crops if extremely tall portrait

## Known Issue / Decision Point
The session crashed mid-build and we accumulated too many patches. If `e39ee4f` still doesn't look right:

**Recommended action: fresh rewrite of ONLY MediaBlock (telegram branch) + TelegramPost.**
DO NOT rewrite the whole file. X is fine. Just those two pieces.

Fresh rewrite approach:
- Bubble: 320px fixed, border-radius: 1rem, overflow: hidden, background gradient
- Image: width: 100%, height: auto, maxHeight: 50vh, objectFit: cover
- No clipPath, no fit-content, no minWidth — keep it dead simple

## Key Lesson From This Session
**ALWAYS commit after every working state and push so Fabio can test on production.**
He tests on `ashapp.atlasai-agents.com` (Vercel), not localhost. Uncommitted changes = invisible to him.
Local dev server runs at `localhost:8080` (started with `npm run dev` in `/Desktop/blackmagic-app`).
**CRITICAL: `vercel --prod` CLI deploys go to a DIFFERENT slot and do NOT update ashapp.atlasai-agents.com.**
**The ONLY way to update ashapp.atlasai-agents.com is: `git push origin main` → triggers GitHub-connected Vercel CI/CD.**

## Phase Context
- Phase 1 of Ash / Black Magic Content Hub is live at ashapp.atlasai-agents.com
- Phase 2 (AI captions) is blocked waiting on Ash's API creds
- Current work is purely UI polish on the Preview tab — not new features
- After this is done: Scheduler page, then Publishing pipeline (X, Telegram, Website)
