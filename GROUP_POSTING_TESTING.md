# Group Posting — Testing Checklist

Test on **localhost** (live app stays untouched). Use the **Tele Test** channel where possible
so we don't spam Ash's real channels. Work top to bottom — earlier tests unblock later ones.

---

## 0. Setup
- [ ] App opens on localhost with no errors (blank screen / red errors = stop, tell Claude)
- [ ] Library loads and shows existing assets
- [ ] Existing scheduled posts still appear on the calendar (nothing lost)

---

## 1. Single posts still work (REGRESSION — must not break)
- [ ] Select **1 image**, pick **Tele Test**, Process → caption generates → Preview looks right → Post Now → lands in Telegram correctly
- [ ] Select **1 video**, pick **Tele Test**, Post Now → posts as a video (not a document), not stretched
- [ ] Select **1 image**, pick **X**, Post Now → single image tweet works
- [ ] Select **1 video**, pick **X**, Post Now → single video tweet works
- [ ] Select **1 portrait video**, Tele Test → NOT stretched on phone (the old fix still holds)
- [ ] Single post to **two platforms at once** (Tele Test + X) → both post correctly

---

## 2. Group posts — Telegram (the main feature)
- [ ] Select **3 images**, pick **Tele Test** → Preview shows them as ONE album collage
- [ ] Caption shows under the album (on the first item), not repeated
- [ ] Post Now → Telegram shows ONE album of 3, not 3 separate posts
- [ ] The album order matches the order you selected them
- [ ] Select **5 images** → album of 5 posts correctly
- [ ] Select **2 videos** → album of 2 videos posts correctly
- [ ] Select **mixed (2 images + 1 video)** to Tele Test → album posts with all 3 (Telegram allows mixing)
- [ ] Caption is the ONE group caption you approved (not blank, not duplicated)

---

## 3. Group posts — X
- [ ] Select **2 images**, pick **X** → Preview shows X's 2-side-by-side layout
- [ ] Post Now → ONE tweet with 2 images
- [ ] Select **3 images**, X → Preview shows 1 big + 2 stacked → posts as one tweet
- [ ] Select **4 images**, X → Preview shows 2x2 → posts as one tweet of 4
- [ ] The image order in the tweet matches your selection order

---

## 4. Group posts — Telegram + X together
- [ ] Select **3 images**, pick **Tele Test AND X** → Preview: Telegram tab shows collage, X tab shows X grid (no crossover)
- [ ] Post Now → Telegram gets the album AND X gets the multi-image tweet, both correct
- [ ] Caption appears correctly on both

---

## 5. Validation rules (should block with a clear message)
- [ ] Select **5 images + X** → blocked: "X allows max 4 images per post. Deselect 1…"
- [ ] Select **1 video + 2 images + X** → blocked: "X can't mix video and images…"
- [ ] After deselecting to fix it → the block clears and Process works
- [ ] Select **5 images + X** but then UNtick X (Tele Test only) → allowed (Telegram has no 4-cap)
- [ ] Select **11 images + Tele Test** → blocked: "Telegram allows max 10 per album…"
- [ ] Valid group selection shows "Posting N as one group" hint (not an error)

---

## 6. Scheduling a group (not Post Now)
- [ ] Make a 3-image group → approve → it appears in "Ready to Schedule" as ONE card with a "3" badge
- [ ] Drag it to a calendar day → set a time → it shows as ONE entry (with count), not 3
- [ ] Click "Publish on Schedule" → saves with no error
- [ ] Refresh the page → the scheduled group still shows as ONE entry (reloads correctly from the database)

---

## 7. Scheduled group actually fires (the cron)
- [ ] Schedule a 3-image group to **Tele Test** for ~2 minutes from now
- [ ] Wait for the cron (runs every 30 min — Claude can trigger it manually to test faster)
- [ ] It posts as ONE album to Telegram (not 3 separate posts)
- [ ] Schedule a group to **X** the same way → fires as one multi-image tweet
- [ ] After firing, the calendar entry shows "posted" status

---

## 8. Deleting a scheduled group
- [ ] Click a confirmed group on the calendar to delete it
- [ ] The WHOLE group disappears (not just one image)
- [ ] Refresh → it's gone from the database too (doesn't reappear)

---

## 9. Google Sheets export
- [ ] Schedule a 3-image group, then click "Export to Sheets"
- [ ] The 3 assets each get their own row (one row per asset — correct)
- [ ] The 3 rows are next to each other (group stays together), in selection order
- [ ] Export again → no duplicate rows (already-exported assets are skipped)

---

## 10. Website (edge case — not an album)
- [ ] Single asset → Website → posts as normal (unchanged)
- [ ] If you group + Website: confirm behaviour is acceptable (posts cover asset). Flag to Claude if you want each asset as its own website entry instead.

---

## When all boxes are ticked
Tell Claude "tests pass, deploy it" → full deploy to `blackmagic-app-live` → Ash gets it.

## If anything fails
Note WHICH checkbox + what happened (screenshot helps) → Claude fixes on the branch → re-test that item. Live app stays untouched throughout.
