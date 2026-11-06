-- Atomic, service-role-only cache writer: Telegram message IDs cannot move backward
-- if two forwarded messages arrive out of order. No registration or draft writes.
CREATE OR REPLACE FUNCTION public.bb_bank_readonly_cache_notice_v1(
 p_chat text,p_thread bigint,p_user text,p_message_id bigint,p_notice jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF current_user <> 'service_role' THEN
  RAISE EXCEPTION 'Only Bank Assistant server may cache recent notice';
 END IF;
 IF nullif(btrim(coalesce(p_chat,'')),'') IS NULL
   OR p_thread<0 OR p_user !~ '^[0-9]{5,20}$'
   OR p_message_id<=0 OR jsonb_typeof(p_notice) IS DISTINCT FROM 'object'
   OR length(p_notice::text)>6000
 THEN RAISE EXCEPTION 'Invalid read-only bank notice'; END IF;
 INSERT INTO public.bb_bank_readonly_last_notice(
   telegram_chat_id,telegram_thread_id,telegram_user_id,
   telegram_message_id,notice,updated_at,expires_at
 ) VALUES(
   p_chat,p_thread,p_user,p_message_id,p_notice,now(),now()+interval '20 minutes'
 )
 ON CONFLICT(telegram_chat_id,telegram_thread_id,telegram_user_id)
 DO UPDATE SET
   telegram_message_id=excluded.telegram_message_id,
   notice=excluded.notice,
   updated_at=excluded.updated_at,
   expires_at=excluded.expires_at
 WHERE excluded.telegram_message_id>=public.bb_bank_readonly_last_notice.telegram_message_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.bb_bank_readonly_cache_notice_v1(text,bigint,text,bigint,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_bank_readonly_cache_notice_v1(text,bigint,text,bigint,jsonb)
 TO service_role;
