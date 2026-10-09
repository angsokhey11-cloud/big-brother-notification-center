# BIG BROTHER — Invoice Photo Organizer

**Status (09 Oct 2026):** Routing UI, configurable private reviewer, mandatory-manual review configuration and ephemeral review-task database structures are implemented on BIG BROTHER DEV. **Photo collection webhook, private Telegram question/reply handlers, image correction and album delivery are not built/activated yet.** The existing Bank Assistant webhook and code are unchanged.

## Final agreed operation — human review is REQUIRED for every image

1. Staff upload one original photo for each paper invoice to a mapped source Telegram group, topic, or private chat.
2. Bot collects the photos into one review batch when the source has been idle for its configured interval (default 60 seconds). Number of photos is unrestricted; 14 photos is a normal example.
3. Bot creates ONE **private Telegram review task** for the mapped reviewer (the positive numeric Telegram User ID from Telegram Manager). Staff groups must never receive review questions. Reviewer must have started a private chat with the bot.
4. Show each original photo in turn and prompt the reviewer for **both the invoice number and invoice date on every photo**, even if an OCR attempt appears certain. A good UX is `002351 | 07/10/2026` with Next/Previous/Edit navigation. The bot can omit OCR entirely.
5. After every photo has confirmed metadata, show the ordered summary and provide a final **Approve & Send** action. The reviewer can change any date/number before final approval.
6. A separate image worker crops/straightens/enhances ORIGINAL photo pixels conservatively, preserving all handwriting, QR codes, amounts, and signatures. Never use generative image recreation; never visually replace printed/written numbers or dates.
7. Sort photos by reviewer-confirmed invoice date and then reviewer-confirmed invoice number (preserve leading zeros and duplicate numbers). Send the corrected original-image-derived photos as Telegram albums of up to 10, one original invoice per individual picture. When an album would contain exactly one photo, use `sendPhoto`.
8. Send the same ordered albums to **all enabled mapped destinations**, including the source group/topic and the private chat. Each target must be mapped in Telegram Manager, no hardcoded chat IDs.
9. After successful delivery to ALL required destinations, immediately remove temporary file references, review metadata, and processing copies; no permanent invoice image storage. Track successful destinations until full success to avoid duplicating albums on retries.
10. Pending human-review jobs are temporary and expire after 24 hours by default. The future worker should remind the reviewer before expiry and explain if data expires; it must never silently auto-approve or send unreviewed photos. Temporary data is removed on expiry. Telegram's own chat media history is not deleted by our bot's database cleanup.

## Implemented artifacts

- `invoice-photo-organizer.html`: Admin Telegram Manager entry for mapping source and destinations, mandatory manual review notice, reviewer user ID, harmless test.
- Supabase `bb-invoice-photo-routing`: JWT-required, active BIG BROTHER admin-authenticated API for mapping. Source mappings are always saved **inactive** until review bot and image processor are safe to enable.
- `bb_invoice_photo_routes`: one source per group/thread, a configured private reviewer, idle interval, `review_mode='manual_all'` enforced by a database CHECK.
- `bb_invoice_photo_destinations`: many configurable group/topic/private output chats per source.
- `bb_invoice_photo_review_batches`: temporary grouped task, private reviewer, collecting/review/delivery status and 24-hour expiry. No image bytes.
- `bb_invoice_photo_queue`: temporary Telegram photo file IDs, optional review batch ID, per-image `review_state` requiring confirmation, invoice number, date, reviewer ID and timestamp. No image bytes.
- 15-minute cron jobs `bb_invoice_photo_queue_ttl` and `bb_invoice_photo_review_batch_ttl` purge expired temporary records.
- All new tables have RLS enabled and direct anon/authenticated access revoked.

## Remaining implementation and QA

1. Build an authenticated incoming-photo dispatcher branch. Preserve existing Telegram webhook secret validation and all Bank Assistant behavior.
2. Build batch collection and de-duplication by Telegram update/message identifiers.
3. Build private review task creation, per-photo previews, typed number/date answer parsing and validation, per-photo corrections, explicit final batch approval, and unique reviewer authorization. The review message must never be delivered to a group.
4. Enforce backend delivery gate: all photos have confirmed metadata AND the matching assigned private reviewer clicked final approve. Fail closed; never trust OCR.
5. Build non-generative perspective/crop/contrast image processor and test with paper invoice samples; if uncertain, preserve entire original photo.
6. Build sorted Telegram mediaGroup delivery to mapped group and private chat (10 max), retry state per destination; handle singleton last group.
7. Build safe review TTL reminders, expiry reporting, cleanup on success and on expiry.
8. Run full dry-run and live tests using non-sensitive sample invoices in a dedicated test group. Only then add admin-controlled activation.

## Non-negotiables

- No paid AI Vision or OCR is required for date/number recognition; manual private reviewer input is the authority.
- No changes to accounting records.
- No AI document redraws; dates/numbers are sorting metadata, not edits to the image's content.
- No auto-approval even if software predicts date/number.
- No permanent picture database.
- No Telegram IDs embedded in bot source.
