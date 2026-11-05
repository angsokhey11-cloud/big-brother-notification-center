# BIG BROTHER — Explicit Telegram Bank Review Sessions (2026-11-05)

## Why

A bank-like message in a shared Telegram topic must **not** become review material without an explicit command. Automatic registration has already been disabled.

## Commands and buttons

1. In a mapped Bank Assistant group/topic, an authorized Telegram admin sends `/starttransactionsreview`.
2. Bot responds **Okay, I'm Ready.** A 24-hour collection session starts, scoped by session UUID, Telegram group ID, topic ID, and initiating admin.
3. Only bank forwards and uploaded notices **from the initiating admin after this command** enter that session. Ordinary messages and pre-session forwards are ignored. Older raw Telegram queues cannot be replayed into review.
4. After the first notice, the bot sends one live status message showing received count and separate USD/KHR notice totals (not bank balance). Subsequent forwards update that message.
5. **Review Now** closes collection, links **only this session's notices** to a private, manual Bank Review batch, and delivers a private review link. No auto-registration.
6. **Continue More** acknowledges and leaves collection open; uploads continue to update the same status.
7. `/reviewtransaction` is an alternate manual way to close and review the current started session.
8. `/canceltransactionsreview` discards an *unreviewed* collection and its temporary drafts, leaving accounting history intact.
9. `/replytransaction`, when sent as a reply to an existing text bank notification, invokes the preserved original **read-only** sender/customer/A/R/duplicate analysis. It does **not** create a review draft.
10. `/checktxn ID` retains the existing historical transaction lookup.

## Safeguards and lifecycle

- Only authorized Telegram admins can start/review/cancel a collection.
- Server-only RPCs enforce session ownership, mapped topic, and non-expiry.
- Maximum 100 notices per collection, with separate USD/KHR totals; missing/unsupported image text remains unparsed and needs manual entry.
- **No automatic bank registration** during collection or review creation. Final admin approval in the existing private review interface remains necessary.
- The temporary session, associated drafts and review-batch row are deleted only after successful `completed` or `cancelled` terminal review state. Prior manual-review rows are not deleted by this feature.
- Existing Bank Register, A/R, invoice payments, bank payer directory and audit logs are never erased by this cleanup.
- Expired *collecting* sessions are pruned when the next collection begins in that topic; in-progress reviews are not silently removed.
- The older legacy review batch and new explicit-session review are indexed separately to prevent cross-session mixing. No legacy financial records were altered.
- The original parser and prior manual review mini-app remain intact. The redesigned **bulk-review table** is a separate UI improvement and is not claimed as part of session gating.

## Files

- `bank-assistant/index.ts`: Telegram command, session intake, two buttons and summary updates.
- `bank-transaction-batch-review/index.ts`: terminal review cleanup.
- `bank-assistant/sql/20261105_explicit_review_sessions_v1.sql`: sessions table and protected server RPCs.
- `bank-assistant/sql/20261105_session_ignore_legacy_review_v1_1.sql`: explicit session boundaries.
- `bank-assistant/sql/20261105_separate_legacy_and_explicit_review_index.sql`: legacy review isolation.

## Verification

Tested in one rolled-back PostgreSQL transaction: start -> stage USD 198.80 + KHR 483000 -> check totals -> Review Now -> cancel -> delete 2 temporary drafts, session and review batch. No test bank entries persisted.

Live Telegram messaging must be tested by a human user. No automatic approval was triggered during verification.
