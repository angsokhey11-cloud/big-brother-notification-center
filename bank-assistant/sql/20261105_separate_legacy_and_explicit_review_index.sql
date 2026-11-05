-- Preserve one-active-review guard within each workflow, while keeping
-- one legacy review and one explicit-session review isolated for the same reviewer.
-- This does not alter existing review rows or bank balances.
CREATE UNIQUE INDEX IF NOT EXISTS bb_bank_review_one_open_legacy_per_reviewer
 ON public.bb_bank_transaction_review_batches(reviewer_telegram_user_id)
 WHERE review_session_id IS NULL AND status IN ('reviewing','processing','partial');
CREATE UNIQUE INDEX IF NOT EXISTS bb_bank_review_one_open_session_per_reviewer
 ON public.bb_bank_transaction_review_batches(reviewer_telegram_user_id)
 WHERE review_session_id IS NOT NULL AND status IN ('reviewing','processing','partial');
DROP INDEX IF EXISTS public.bb_bank_review_one_open_per_reviewer;
