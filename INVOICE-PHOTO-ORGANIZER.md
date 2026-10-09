# BIG BROTHER — Invoice Photo Organizer
Status: routing editor and secure admin API deployed to BIG BROTHER DEV on 09-Oct-2026. **Photo processing is not activated.** Existing Bank Assistant webhook is unchanged.

## User-approved workflow
1. An administrator maps one source Telegram group, forum topic, or private chat.
2. An administrator maps one or many destination chats (group/topic/private); all IDs are DB-configured, never hard-coded.
3. Staff upload one picture per physical invoice. Several pictures are collected until a configurable idle interval (default 60 seconds).
4. Detect paper bounds, carefully crop/straighten/rotate, improve readability using real deterministic image operations **only**. Do not use image generation, redraw characters, modify signatures/QRs, or retouch financial content.
5. Read invoice date, then invoice number using a verified OCR/vision engine. Sort ascending date, then ascending invoice number. Duplicate invoice numbers remain separate. Uncertain dates/numbers require review.
6. Send original-image-derived processed photos to every enabled destination via Telegram's `sendMediaGroup` in groups of 2 to 10. If last group contains one item, use `sendPhoto`. ONE invoice = ONE picture; no contact sheets or collage.
7. Delete temporary image bytes, file references and row metadata once delivery succeeds to all destinations. On failures, retry within 2 hours, then expire and delete. Telegram's own chat/media storage is outside our database's control.

## Installed admin mapping
UI: `invoice-photo-organizer.html` linked from Notification Center sidebar.
API: `bb-invoice-photo-routing` (JWT required, checks active BIG BROTHER admin).
DB:
- `bb_invoice_photo_routes` — unique source group/chat + thread, idle seconds, inactive until worker verified
- `bb_invoice_photo_destinations` — unlimited destination mappings per source
- `bb_invoice_photo_queue` — ephemeral Telegram file IDs only; no images or blobs

All 3 tables have RLS enabled and direct browser access revoked. `cron.job` `bb_invoice_photo_queue_ttl` deletes expired temporary references every 15 minutes. Admin endpoint supplies harmless `destination_test` action.

## Required remaining work before activation
- Select and configure a vision/OCR service; validate extraction against uploaded handwritten/printed examples. Handle unreadable dates without inventing.
- Build an image-correction worker for Supabase Edge Functions (ImageMagick WASM is documented as supported, native Sharp is not).
- Build batch finalization, queue lock/idempotency and per-destination delivery checks. Ensure recipient failures do not resend to successful destinations.
- Add a webhook dispatcher branch to `bb-bank-assistant` **only after** end-to-end tests; preserve the existing banking path and Telegram webhook secret.
- Finish group/private chat access verification and opt-in. Private recipient must first start the bot. Telegram group must allow bot to read photos.
- Run live test in a dedicated test group with non-sensitive example invoices, then allow admin to activate sources.

## Safety
No accounting writes. No permanent invoice picture data. Never pass service-role credentials to browser, never expose Telegram token. Provider retention requirements must be disclosed and separately configured if an external AI vision service is used. Source routes are deliberately saved `active=false` by current admin function to prevent premature processing.
