## On-demand batch review & personal route — 09 Oct 2026

**New workflow:** The Bank Assistant continues normal transaction analysis and normal replies for each forwarded TEXT/CAPTION bank notice. Eligible notices are silently held as temporary candidates. No review message or register-button is automatically sent on every bank notice. Only `/reviewtransaction` initiates a private batch.

**Personal routing:** An authorized admin maps each Bank Assistant group/topic to a particular authorized private Telegram account in [Bank Personal Review Routes](bank-review-routing.html) (available from Telegram Manager). `bb_bank_review_personal_routes` is unique per group/topic. If no route exists or is paused, the bot does NOT fall back to the command sender or any guess.

- In a mapped Bank Assistant topic, an authorized admin sends `/reviewtransaction`. The command is queued behind earlier bank forwards so previous standard analysis completes first. The bot finds that topic's configured private reviewer and sends the WebApp task ONLY to that personal chat.
- In a private Telegram bot chat, an authorized reviewer may use `/reviewtransaction` only when exactly one active Bank Assistant personal route belongs to that account. If multiple mapped topics belong to the same person, request review inside the specific Bank Assistant topic to prevent mixing financial locations.
- A second command for the same pending batch reopens it, not duplicates it. A reviewer cannot start another topic's batch until the current one is complete.
- All review candidates are scoped to the specific source chat/topic and assigned reviewer. Drafts expire after approximately 24 hours, with periodic cleanup.
- The new [Bank Transaction Batch Review](bank-transaction-batch-review.html) Mini App requires a signed Telegram WebApp session AND active BIG BROTHER administrator login.
- Review every parsed bank transaction: **New Invoice** (choose customer and saved payer, confirm currency/date/transaction ID) or **Leave Alone** (A/R, previous invoice, deposits, other).
- A missing customer's bank payer opens the Customer Bank Directory popup. This uses existing admin-protected `bb_customer_bank_identity_save`; existing matching identity is selected to avoid duplicate entries.
- After every item is reviewed, the final summary shows selected vs ignored transactions. Admin confirms a second time to register ONLY New Invoice selections.
- Each approved transaction uses existing `bb_bank_register_invoice_tx_v4` under that admin's authenticated Supabase JWT, preserving all duplicate transaction/finance checks. On network ambiguity, the Mini App first checks the recorded transaction against the reviewed draft before trying again, and successful rows are skipped. A/R invoice payment and collection writes are NEVER made by this workflow.
- If a bank notice's sender/amount/currency cannot be parsed, its usual Bank Assistant warning still appears; it will not silently fabricate a review entry.
- For this release only **text/caption bank notifications**, not photo-only bank-slip OCR, are eligible.

**DEV components:** `bb-bank-assistant` v40; `bb-bank-transaction-batch-review` v1; migrations for `bb_bank_transaction_review_batches`, `bb_bank_review_personal_routes` and enhanced draft metadata; admin SQL RPC `bb_bank_review_route_list`/`bb_bank_review_route_save`; cleanup cron jobs for drafts and batches.

**Verification:** DB test with 10 synthetic notices -> one assigned batch -> repeated request reopens it -> unrelated reviewer denied, all rolled back. Admin route RPC list and save passed using rolled-back admin login. Frontend routing and batch-review JavaScript syntax compiled. Edge source matches deployed versions. **Live Telegram bank-forward → batch → directory popup → final registration is NOT YET end-to-end tested. Do not test with actual accounting transactions until the no-write flow works.**

**Setup required:** No private Bank Assistant routes were automatically created. An admin must map the intended reviewer User ID(s) to the active Bank Assistant group/topic(s) in Telegram Manager. This is intentionally explicit to avoid sending financial data to the wrong Telegram account.

---

# New Invoice — Telegram Bank Register Review

## Status — 09 Oct 2026
BIG BROTHER DEV beta. Bank Assistant webhook v39 and private review API `bb-bank-new-invoice-review` v1 deployed; mobile-friendly review page `bank-new-invoice-review.html` committed to GitHub Pages. The new finance flow has **not yet been confirmed in a real Telegram bank-notice → registration test**. Test without real financial writes first by opening the form and selecting **Leave This Transfer Alone**.

## Scope: ONLY NEW INVOICE GENERATOR PAYMENTS
- Incoming recognized text/caption bank notices in authorized Bank Assistant group/topic routes can offer the admin-only `New Invoice — Register Bank Payment` action.
- This action **does nothing to the ledger** until the admin explicitly opens the private review and confirms a **new Invoice Generator invoice** purpose.
- Not for A/R collections, previously issued invoice payments, expenses, deposits, or unrelated bank transfers. For those, **Leave This Transfer Alone**; existing collection flows are unchanged.
- If sender has no Customer Bank Directory identity, or its name does not map to a customer, the review allows picking an active customer manually.
- When chosen customer has no active saved payer, **Register Bank Payer** dialog automatically appears. Admin must explicitly save the bank name and account holder, plus optional account number and alternative names, via existing `bb_customer_bank_identity_save` RPC. This is immediately stored in the existing Customer Bank Directory, and does not itself register any bank transaction.
- Payers already in the directory may be selected instead. A nonmatching new payer can be added manually from the dialog even for a customer who already has other bank payers.
- Transaction ID, received date, actual USD/KHR amount, invoice currency and exchange rate are confirmed by the admin. Actual invoice currency defaults to bank currency; cross-currency requires explicit KHR-per-USD exchange rate. Missing transaction IDs must be manually filled in.
- **Confirm & Register for New Invoice** uses the existing protected `bb_bank_register_invoice_tx_v4` RPC under the logged-in BIG BROTHER administrator's Supabase session. No service-role bypass of `bb_is_admin`. This RPC rejects duplicated transaction IDs across bank register, payments, deposits, and cancelled transaction IDs, and validates the selected active customer payer.
- Successful registration creates an `AVAILABLE` entry for Invoice Generator to consume later. No invoice, payment, or A/R entry is created by the Telegram review.
- Reviewer identity is validated twice: signed Telegram Mini App initData plus configured Telegram admin ID, and separate active BIG BROTHER app administrator session. The reviewer must claim the precise bank notice in its mapped group/thread.
- Drafts hold only parsed notice metadata and expire after 24 hours, with a 15-minute cleanup cron. No bank-slip picture binaries stored.

## Code and database
- `bank-assistant/index.ts` Bank Assistant webhook contains `newInvoiceRegisterPrompt` and `newInvoiceRegisterClick`, alongside the unchanged existing bank notice parsing and private invoice photo organizer.
- `bank-new-invoice-review.html` shows the admin form and missing-payer popup. Uses existing protected `bb_bank_register_customers`, `bb_customer_bank_identity_list`, `bb_customer_bank_identity_save`, and `bb_bank_register_invoice_tx_v4` functions.
- `bank-new-invoice-review/index.ts` is an Edge Function for signed private draft lookup, discard and post-registration audit.
- `bb_bank_new_invoice_review_drafts` with no anon or authenticated direct SQL access. `bb_bank_new_invoice_claim` server-only reviewer/topic claim RPC. `bb_bank_new_invoice_review_ttl` cron.
- Confirmed transaction details remain in `bb_verified_bank_transactions` even after draft expiry, subject to existing bank register retention rules.

## Tests
- Database dry run passed: authorized reviewer can claim, wrong group topic cannot, unauthorized Telegram user cannot; all synthetic test rows rolled back.
- Private form JavaScript syntax compiled; markup checks for missing-payer popup, existing bank directory save RPC, existing bank register RPC, and required new-invoice confirmation checkbox.
- Bank Assistant source inspected for original webhook secret validation, bank routing/notice queue, photo organizer, and absence of direct accounting writes in Telegram webhook.
- Real bank notice parser flow, Telegram reviewer notification, authenticated directory write, and bank register consumption are still untested end to end.

## Initial test
1. Forward a harmless **text** sample bank notice with sender, amount, currency and ideally transaction ID into a mapped Bank Assistant group/topic. Bank photo OCR is not included; source must have readable text or caption.
2. Look for **New Invoice — Register Bank Payment** below the Bank Assistant's parsed notice. Tap it using an authorized Telegram admin account.
3. Bot messages the administrator **privately** with **Review New Invoice Bank Register**. Open the Mini App and sign in with an existing BIG BROTHER DEV administrator account; don't enter credentials into a group chat.
4. Choose a customer with no saved payer. Verify the bank payer popup opens; for a no-write test, cancel it and click **Leave This Transfer Alone**.
5. For a genuine intended **new** Invoice Generator sale, save the payer to the bank directory and then explicitly confirm the bank transaction; verify status `AVAILABLE` in Bank Register. DO NOT register any A/R payment from this screen.
