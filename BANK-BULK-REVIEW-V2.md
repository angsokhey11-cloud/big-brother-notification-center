# BIG BROTHER — Bulk Bank Review V2

## User-facing change

The Review Now action for an explicitly started /starttransactionsreview collection opens
`bank-transaction-bulk-review.html`, rather than the legacy transaction-by-transaction Save & Next screen.

**All forwarded notices appear in one page**, each with:
- checkbox, amount, bank reference, payer name, and matched/duplicate/unknown status
- editable inline customer assignment (search by customer name, ID or location)
- inline detail editor for unknown/image notifications (payer name, bank/date/ref/currency/amount)
- company staff identification — beneficiary must be selected, no permanent directory mapping by default
- optional explicit **Save Payer to Directory** for a customer (a separate authorized action)
- current available bank balances and outstanding A/R, split by USD/KHR, with projected same-currency balance if selected

Buttons **Select Suggested** and **Clear Selection** make a batch easy to review.
No checkboxes are selected automatically in a fresh review.
Unknown or ambiguous customers and staff deposits cannot be included in Select Suggested.
Existing transaction IDs (including manually entered Admin IDs in Payment History or Bank Register)
and repeated references within the same batch are blocked.

**One Confirm & Register** action:
1. Shows confirmation with number and USD/KHR totals.
2. Rechecks duplicate IDs against historical records and the current batch.
3. Calls `bulk_prepare` to save ALL selected and not-selected decisions atomically.
4. Calls the existing `approve` (changes batch to processing).
5. Registers each selected entry using existing admin-authenticated
   `bb_bank_register_invoice_tx_v4` or `bb_bank_register_invoice_tx_no_directory`,
   followed by `record` for idempotent reconciliation.
6. Calls `finish` to clean up temporary explicit-session drafts after all selected
   entries have been recorded.

If interrupted while processing, **Resume Final Registration** reloads the saved decisions,
checks already registered items before retrying, and never repeats successful records.

Neither the screen nor the new bulk-prepare function automatically pays invoices, clears A/R,
converts currencies, or registers money before an explicit final admin confirmation.

## Compatibility

- `bank-transaction-batch-review.html` stays in place for old manual review batches.
- Previously sent explicit-session links using `?v=explicit-bank-session-20261105`
  redirect to the new page, preserving both URL query and Telegram WebApp authentication hash.
- New explicit-session Telegram links point directly at `bank-transaction-bulk-review.html`.
- The original Save & Next UI and its backend actions are retained for older batches.
- The session scope and terminal database cleanup introduced in V67/V9 are preserved.
- No change to Cloud→Local sync database tables from this UI enhancement.

## Backend changes

- `bb_bank_review_bulk_prepare_v2`: service-role-only, atomic preparation of up to 100 reviewed
  choices; validates active customer, exact saved payer or one-time payer name, amount/currency/date,
  and old/new duplicate transaction IDs. **No financial write**.
- `bb_bank_review_inspect_v2`: service-role-only, read-only analysis of existing references,
  available bank balances and outstanding A/R; data displayed as independent USD/KHR totals.
- Review Edge Function V2 actions `load_bulk`, `bulk_inspect` and `bulk_prepare` reuse existing
  Telegram WebApp signature, BIG BROTHER Admin JWT, reviewer mapping and batch authorization.
- Existing `save`, `approve`, `record`, `finish` and `cancel` actions are untouched.

## Verification done without changing real money

- JavaScript code compiles; mock test confirms matched sender is selectable, staff/unknown are unassigned,
  and a reference in Payment History is flagged as duplicate.
- Rolled-back SQL test: select 1 transfer, exclude another, reselect neither; `bb_verified_bank_transactions`
  count unchanged and reviewed decisions persisted atomically within test transaction.
- Rolled-back duplicate test: known old Payment History ID rejected by bulk preparation.
- All tests rolled back; no test Bank Register entries or review sessions persisted.

## Manual acceptance check

Open the existing private Review Now button on a previously started explicit session.
It should automatically redirect to the new bulk page, showing all 9 notices rather than
`Transaction 1 of 9` with Save & Next.
Check duplicates, suggested customers, one-time staff assignment, balance analysis and checkbox
totals before **any final registration**. The final confirmation writes real bank balances.
