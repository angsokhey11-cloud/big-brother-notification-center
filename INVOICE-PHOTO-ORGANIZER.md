# BIG BROTHER — Invoice Photo Organizer

**Status (09-Oct-2026):** DEV has a private-forwarding-only routing editor/API, private reviewer mapping, mandatory-manual-review DB guards, temporary queues/tasks, and automatic expiry cleanup. **The real Telegram image-intake dispatcher, private review chat UX, picture correction worker and album sender are not built/activated.** Existing Bank Assistant and Telegram webhook remain unchanged.

## Final agreed workflow (private-first; groups are OUTPUT only)

1. The authorized user **forwards selected invoice pictures into their own private Telegram conversation with the BIG BROTHER bot**. The bot must not scan, monitor, collect, or auto-import any picture in a Telegram group/topic. Photos in groups may be unrelated to invoices.
2. Upon receiving the user's forwarded photo messages in private (and only from `chat.type='private'`, with `chat.id=from.id=reviewer_telegram_user_id`), the future worker groups them into one temporary review batch after a configurable idle interval, default 60 seconds. No group chat can be an input.
3. The bot privately creates a review task with every forwarded picture, numbered 1/N, ideally with Previous, Next, Edit and End Review controls. Forwarding is how the user chooses invoice photos. Do not require OCR or automatically trust OCR metadata.
4. The same authorized user **enters or edits the invoice number and date of EVERY picture**, for example `002351 | 07/10/2026`. Preserve leading zeros and check dates; all photo metadata must be confirmed before proceeding. Editing these metadata fields does NOT alter the text printed on the physical invoice picture.
5. Show complete ordered summary; **Approve & Send** is a separate explicit final step. Until the reviewer confirms the full batch, nothing is delivered.
6. Crop, straighten and improve contrast using deterministic transforms of ORIGINAL image pixels only, preserve the actual handwriting, signature, QR code, prices, customer details. No generative image re-creation. If paper edges are uncertain, preserve the whole original image.
7. Sort by reviewer-confirmed date then invoice number, sending each separate invoice as a separate Telegram photo. Use `sendMediaGroup` in albums of max 10; if only one remains, `sendPhoto`.
8. Send the exact same ordered albums to all configured **output** destinations: the chosen group/topic and the reviewer's private Telegram chat. Both must be configured; group is never the source. All source, reviewer and destination IDs come from DB mapping, never hardcoded.
9. Keep only temporary Telegram photo references and review metadata (no image blobs in DB). After confirmed delivery to both destinations, delete temporary copies/references. For unsuccessful sends retry within the expiry window without duplicating successfully completed destinations. Pending reviews expire after 24 hours, with eventual cleanup and ideally prior reminder. Telegram-managed media remains in Telegram.

## Connected private reviewer and routing diagnostics (09-Oct-2026)

- Existing active Telegram administrator has an authorized private photo-organizer route in BIG BROTHER DEV. The route itself stays disabled until the image worker is implemented.
- The route now has TWO active output mappings: one group/topic and the reviewer's own private chat. All IDs come from saved DB mappings; no hard-coded chat/user IDs.
- Existing shared Telegram webhook (`bb-bank-assistant`, version 32) includes a strictly private `PHOTO` / `/photostatus` command that confirms the current caller is the mapped admin reviewer and reports output destination counts. It never posts routing status to group.
- `/phototest` (private and administrator-only) sends an explicit harmless message to each enabled mapped destination and replies privately with individual successes/failures. This is a routing test, not an invoice-processing test.
- `/start`, `ID`, and `/myid` continue showing the caller's own Telegram ID in their private chat.
- The existing Bank Assistant group/topic handler, secret validation and transaction logic remain unchanged. Actual Telegram messages have not been end-to-end tested from this conversation; ask reviewer to send `PHOTO` then `/phototest` directly to bot privately.

## Implemented configuration, schema and security

- `invoice-photo-organizer.html` — Telegram Manager sidebar mapping editor. Private reviewer/forwarding source and destinations (including output group/topic and private chat); test private reviewer/destination.
- `bb-invoice-photo-routing` — JWT and active BIG BROTHER admin validated; saves only private intake: `source_chat_id = reviewer_telegram_user_id`, `source_thread_id = 0`, `intake_mode='private_forward_only'`; source routes always remain inactive until processing is tested.
- `bb_invoice_photo_routes` — strong DB CHECK to reject any intake in a group/topic, require positive private user ID, enforce `review_mode='manual_all'`, `intake_mode='private_forward_only'`.
- `bb_invoice_photo_destinations` — independently editable output group/topic/private chat mapping.
- `bb_invoice_photo_review_batches` — temporary review task, assigned private reviewer, status, timestamps, expiry, approval guard.
- `bb_invoice_photo_queue` — temporary Telegram file references, per-image review metadata and manual confirmation guard. No original/processed image bytes.
- Scheduled deletion of expired queue and review tasks; direct client access to DB tables disabled with RLS and grants.

## New photo-by-photo Mini App review UI (09-Oct-2026)

**The reviewer explicitly requested a visual form, not message replies.**

- The private bot now exposes `/review` on Telegram's private slash-command menu. It sends a secure `web_app` button to launch `invoice-photo-review.html` as an in-Telegram Mini App.
- One invoice PHOTO fills the top region; below it are TWO input boxes: native date picker **Invoice Date**, and text field **Invoice Number** (numeric validation, preserve leading zeros).
- `Save & Next` persists the current number/date, advances to the following image; `Previous` allows correction; `Review summary` lists all confirmed details and allows Edit.
- The new `bb-invoice-photo-review` Edge Function verifies the signed Telegram Mini App `initData` HMAC, checks expiration, checks the mapped authorized private Telegram reviewer, loads temporary queue items, safely proxies original Telegram photo bytes, and saves manual metadata through the DB confirmation guard. No photo blobs stored.
- When no pending review exists, the Mini App offers a clearly labeled **UI preview/demo** with placeholder picture areas. Nothing is sent or saved in demo mode.
- **Approve & Send remains DISABLED** until actual forwarding/collection, image correction, Telegram album delivery, and idempotent cleanup are connected and verified. The Mini App is a working review interface and backend, **NOT a complete or live invoice organizer**.
- Telegram private review command reply links to `https://angsokhey11-cloud.github.io/big-brother-notification-center/invoice-photo-review.html`. Do not use this HTML as a public auth mechanism; the API depends on Telegram's signed `initData`. The standalone browser URL only displays preview mode.
- Existing private `/photo`, `/phototest`, `/myid`, `/start`, `/help` and Bank Assistant group commands remain supported.

## Future implementation requirements (not yet live)

1. Build isolated private-forwarded-photo handler, called from existing webhook AFTER secret verification, with strict `message.chat.type === 'private'`, `message.from.id === message.chat.id`, match to an active private-forward-only route for that reviewer, and `photo` plus Telegram `forward_origin` or `forward_date`. Don't ingest ordinary bot messages, own media responses, group photos, or business chatter.
2. Implement explicit reviewer permission checks for every private command/callback, message-to-task correlation, de-duplication, idle flush and batch review UX. Choose a clear way for reviewer to finalize receiving photos or wait for idle timeout. Handle Telegram albums/multiple forwarded messages.
3. Maintain backend guarantee that all invoices have reviewer-confirmed number and date and that same assigned reviewer explicitly approved batch before sending. No auto-approval or guessing.
4. Image correction worker using non-generative CV image operations; test actual samples, always protect content.
5. Sorted delivery in Telegram media albums to BOTH mapped private and group/topic destinations. Use per-destination idempotent delivery/retry bookkeeping and cleanup on successful completion or expiry.
6. Tests on a dedicated test group/private user with non-sensitive invoices; preserve Bank Assistant webhook functionality before enabling source routes. No live group scraping.

## Non-negotiables

- Only photos the reviewer explicitly forwards privately should enter this organizer.
- Group/topic is outgoing delivery only, not watched for pictures.
- Mandatory manual number/date for each invoice, followed by one explicit final approval.
- No paid AI vision/OCR required; don't redraw original financial document contents.
- No permanent picture storage; no accounting modifications; no Telegram chat IDs hardcoded.
