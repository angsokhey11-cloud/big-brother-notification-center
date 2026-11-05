# Bank Review V2 — Preserve Original Payer, Append Aliases & Fast Customer Assignment

Date: 05-Nov-2026

## Accounting reason

A bank transfer sender may have a different displayed name from a customer's original
bank account holder. The original holder is a primary reference, not a replaceable field.
New known names should become **Alternative Names** on the explicitly chosen active
customer payer identity, without replacing the primary holder or existing aliases.

For company staff and third-party deposits that can belong to different customers,
**Register Once** remains the default; do not permanently map their name to one customer.

## What changed

- **Add Alternative Name** on the bulk-review row when the chosen customer already has
  an active bank payer identity. Existing primary holder, bank name, account number,
  customer ID and old alternative names remain untouched.
- When exactly one active identity exists, the original name/bank is shown before confirmation.
  When multiple exist, the admin must **choose the correct original bank identity** from
  a dropdown. We never guess which account should receive the new alias.
- When no identity exists, an explicit **Create First Bank Payer** remains available,
  with a warning to use Register Once for staff or third-party payments.
- Company staff rows hide the directory-save button and the append-only SQL RPC rejects
  active staff names; one-time registration remains possible.
- Reused payer names on any other active bank identity (including another customer)
  are rejected to avoid ambiguous future bank matching. An alias already on the selected
  identity is a safe no-op.
- New SQL RPC: `bb_customer_bank_identity_add_alias_v1(customer_id,identity_id,alias_name)`.
  It is admin-only, serializes competing writes per alias, and only UPDATEs
  `alternative_names`, `updated_at` and `updated_by`.
- **Quick assign performance:** selecting a customer updates only that transaction row
  immediately. A/R and bank balances fetch in the background; per-customer results
  are cached for the page session, requests are debounced/deduplicated, and finance labels
  refresh without re-creating the entire form. A directory alias append no longer calls
  the full directory list again.
- Telegram Review Now link has a new version query to bypass stale cached WebApp pages,
  and the old explicit-session redirect also carries a cache-busting query.

## What did NOT change

- No new bank balance, A/R clearing, invoice payment, or currency conversion happens
  when you assign a customer or append an alternative payer name.
- The original Bank Register approval functions and bulk-review final confirmation remain.
- Existing names / original account holders are **not automatically repaired or merged**.
  The new guard prevents future accidental changes via this Quick Register workflow.
- No unrelated database tables, Local Brain, Telegram bots or scheduler needed changes.

## Verification

- Rollback-only SQL test: append a new alias to an existing account; original
  `account_holder_name`, `bank_name`, `account_number`, `customer_id` unchanged.
- Re-adding same name with different casing/whitespace is idempotent.
- Attempting the same alias on another active identity is rejected.
- Existing Bank Assistant name lookup detects the newly appended alternative name.
- No registered balances added during tests.
- Browser JavaScript compiles; simulation confirmed multiple-account selection,
  preservation of original names, staff one-time behavior, asynchronous finance
  lookup and no full payer-directory re-download after saving an alias.

## Operator test

1. Open a new Bulk Bank Review from `/starttransactionsreview` or re-send
   `/reviewtransaction` for an existing active session.
2. Expand an unknown payer, choose a customer with an existing bank account.
3. Confirm the **original holder** and use **Add Alternative Name**.
4. Check the original holder still exists and the new name appears in alternative names.
5. Try another customer; assignment should appear immediately and bank balances update
   separately. **Do not press Confirm & Register** unless the amounts/customers are correct.
