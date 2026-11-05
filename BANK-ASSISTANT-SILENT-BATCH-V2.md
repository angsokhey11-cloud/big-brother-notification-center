# BIG BROTHER — Silent Bank Assistant & Safe Batch Auto-Registration

## Operator workflow

1. Forward ABA, ACLEDA (Khmer USD/KHR), or supported bank text notifications to a mapped Bank Assistant Telegram topic.
2. **There is no immediate bot response** for each notice. The existing FIFO queue records the source message, parses it and stores an unreviewed candidate; a seven-day expiry allows end-of-day batches.
3. An authorized Telegram administrator sends `/reviewtransaction` in that mapped topic.
4. The bot drains outstanding queued notices, then processes up to **100 candidates per command** and checks Bank Register and payment/deposit/cancelled transaction IDs.
5. Transfers with a **single active payer identity and customer**, positive amount, valid currency, date and transaction reference (and no staff sender or contradictory reference) are registered as `AVAILABLE` customer bank balances.
6. Already-used references are skipped without adding a second bank balance. Missing IDs, unknown/shared payer names, staff deposits, invalid fields or conflicting notices remain for private administrator review.
7. The bot posts **one summary**: registered counts, USD/KHR totals, duplicate references, and manual-review count. It sends existing private mini-app review links only when exceptions remain.

## Accounting and authorization rules

- **Never** auto-clear A/R, create sales revenue, update invoice paid amounts, deduct stock, or convert USD/KHR during bank registration.
- The actual bank currency is stored unchanged. `invoice_currency=currency`, `approved_exchange_rate=1`. Cross-currency use requires the existing separate approval process.
- Auto-registration is an atomic, database-protected write, not a direct Edge Function insert. The SQL RPC `bb_bank_assistant_auto_register_v1` is **service-role only**, validates both requester and reviewer Telegram admins, exact active group routing, and the active administrator who configured that review route.
- Existing `bb_verified_bank_transactions.created_by` remains NOT NULL and records the authorizing route administrator (not an invented bot user). The real Telegram command initiator, reviewer, source message, and exact matched payer identity are preserved in the immutable `bb_audit_log` and the review draft metadata.
- The existing Bank Register unique ID and cross-table duplicate guards remain in force. Row locks + transaction-ID advisory locks prevent races under concurrent requests.
- No new tables or table columns are introduced. The bot RPC is Cloud-side; normal Cloud→Local data sync continues to sync Bank Register rows. Do **not** use Local→Cloud Upload to deploy this change.
- Existing review mini-app and `/bankadd` approval stay in place.

## Acceptance tests

- ACLEDA USD / KHR Khmer-digit examples parse correctly without immediate Telegram responses.
- Ten forwarded notifications produce no per-message replies; a single `/reviewtransaction` produces one topic summary.
- A registered transaction ID re-forwarded is skipped (including a bare forwarded ID).
- Unknown, same-name multi-customer, staff sender, missing transaction ID, invalid amount/date and conflicting notices are held for private review.
- A uniquely matched payer and new ID creates exactly one `AVAILABLE` Bank Register entry, preserving currency, received date, payer identity and audit trail.
- Repeating the command does not register any transfer twice.
- Remaining A/R, invoice payment, Bank Balance and Local Sync behavior is unchanged.

## Deployment

1. Install `bank-assistant/sql/20261105_silent_auto_bank_register_v1.sql` in Cloud Supabase (installed).
2. Deploy `bank-assistant/index.ts` as Edge Function `bb-bank-assistant` using its **existing** webhook security settings, secrets, and `verify_jwt=false`.
3. Verify function version and inspect one benign Telegram batch. Existing registered balances are not changed during deployment.
