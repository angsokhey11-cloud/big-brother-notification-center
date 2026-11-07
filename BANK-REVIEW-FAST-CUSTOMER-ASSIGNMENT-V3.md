# Bank Review V3 — Fast Customer Assignment (07-Nov-2026)

## Problem
The Bulk Review showed **Create First Bank Payer** even when no customer had been selected.
For an existing customer without a bank payer identity, the user felt required to create a
permanent payer record before they could review/register the bank transfer. That process adds
confirmation dialogs and an authenticated network round trip for every new payer.

## Updated workflow
- Type a few characters of existing customer name, ID, or location. Search is local, with a
  normalized index built once when the review is loaded; priority favors exact ID,
  beginning of ID and beginning of name.
- Every match has **Assign & Select for Review** and **Assign only**.
- Assign & Select picks the beneficiary and checks the transfer **in one click**.
  An unknown/third-party or company-staff payer uses the existing **one-time registration**
  path: payer_identity_id=NULL, payer_name retained. There is **no bank directory write**.
- The transfer will only be registered when the admin presses the existing
  **Confirm & Register** button and passes the duplicate/customer/amount checks.
- Already registered transaction IDs and invalid records cannot be checked via Quick Select.
- The separate **Create First Bank Payer (Optional)** action is visible only after a customer
  has been assigned. It retains its existing explicit admin confirmation and server RPC.
- Customers with a saved payer identity continue to use that verified identity;
  manually changing the customer re-evaluates exact-match status so an old match cannot
  mistakenly appear as matching a different customer.
- Company-staff rows can be one-time assigned and stop being counted as 'Need assignment'
  once a beneficiary is selected.
- If a customer does not yet exist in Customer Management, the search does not invent one.
  Customer creation must happen through the existing customer management workflow.

## Security and accounting
- No database migration.
- No change to the protected final Bank Register functions or duplicate-ID checks.
- No automatic payment registration, A/R clearing, invoice payment, or directory modification.
- The original Add Alternative Name function remains append-only and unchanged.

## Deployment
- Bulk review HTML updated.
- The bot's private Review Now link versioned to
  `bank-review-fast-assign-v3-20261107` to bypass cached Telegram page.
- The old explicit-session review redirect also has the new version.
- Existing review batches and stored decisions are untouched.

## Verification
- JS syntax parsed successfully.
- Simulation covered fast customer search, one-click selection with no network request,
  one-time unknown and staff payers, saved payer identity, blocking registered references,
  accurate unassigned counters, and final confirmation still required.
- No financial registration was performed during tests.
