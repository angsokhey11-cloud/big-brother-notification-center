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
