-- BIG BROTHER Bank Assistant: short-lived read-only last notice per bank topic and authorized admin.
-- Does not touch the review queue, review drafts, bank balances, payments, or invoice A/R.
CREATE TABLE IF NOT EXISTS public.bb_bank_readonly_last_notice (
 telegram_chat_id text NOT NULL,
 telegram_thread_id bigint NOT NULL DEFAULT 0,
 telegram_user_id text NOT NULL,
 telegram_message_id bigint NOT NULL CHECK(telegram_message_id>0),
 notice jsonb NOT NULL CHECK(jsonb_typeof(notice)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (telegram_chat_id,telegram_thread_id,telegram_user_id)
);
ALTER TABLE public.bb_bank_readonly_last_notice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bb_bank_readonly_last_notice FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.bb_bank_readonly_last_notice TO service_role;
CREATE INDEX IF NOT EXISTS bb_bank_readonly_last_notice_expires
 ON public.bb_bank_readonly_last_notice(expires_at);

-- Reuse the project's 03:00 Cambodia native PostgreSQL scheduler cadence.
-- No polling or Telegram API calls; all expired snapshots are removed daily.
SELECT cron.schedule(
 'bb-bank-readonly-last-notice-purge-3am-kh',
 '0 20 * * *',
 'DELETE FROM public.bb_bank_readonly_last_notice WHERE expires_at < now();'
);
