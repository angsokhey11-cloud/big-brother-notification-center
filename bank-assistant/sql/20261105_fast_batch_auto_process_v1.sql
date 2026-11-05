-- BIG BROTHER — fast, atomic batch dispatcher for existing safe per-draft bank RPC.
-- One client RPC processes up to 100 candidate notices. Each exception remains for review.
CREATE OR REPLACE FUNCTION public.bb_bank_assistant_auto_process_batch_v1(
 p_chat text,p_thread bigint,p_reviewer text,p_command_user text,
 p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v record;
 v_out jsonb;
 v_result text;
 v_total integer := 0;
 v_registered integer := 0;
 v_duplicates integer := 0;
 v_review integer := 0;
 v_errors integer := 0;
 v_usd numeric := 0;
 v_khr numeric := 0;
 v_rows jsonb := '[]'::jsonb;
 v_dup_ids jsonb := '[]'::jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Server-only Bank Assistant batch registration';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Invalid Bank Assistant batch limit';
 END IF;
 FOR v IN
   SELECT d.draft_id FROM public.bb_bank_new_invoice_review_drafts d
   WHERE d.source_chat_id=p_chat AND d.source_thread_id=p_thread
     AND d.status='candidate' AND d.review_batch_id IS NULL AND d.expires_at>now()
   ORDER BY d.created_at,d.source_message_id,d.draft_id
   LIMIT p_limit
 LOOP
   v_total:=v_total+1;
   BEGIN
     v_out:=public.bb_bank_assistant_auto_register_v1(
       v.draft_id,p_chat,p_thread,p_reviewer,p_command_user
     );
     v_result:=coalesce(v_out->>'outcome','review');
     IF v_result='registered' THEN
       v_registered:=v_registered+1;
       IF v_out->>'currency'='USD' THEN
         v_usd:=v_usd+coalesce((v_out->>'amount')::numeric,0);
       ELSIF v_out->>'currency'='KHR' THEN
         v_khr:=v_khr+coalesce((v_out->>'amount')::numeric,0);
       END IF;
       IF jsonb_array_length(v_rows)<12 THEN
         v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
           'customer_id',v_out->>'customer_id',
           'currency',v_out->>'currency',
           'amount',(v_out->>'amount')::numeric,
           'transaction_id',v_out->>'transaction_id'));
       END IF;
     ELSIF v_result='duplicate' THEN
       v_duplicates:=v_duplicates+1;
       IF jsonb_array_length(v_dup_ids)<12 THEN
         v_dup_ids:=v_dup_ids||jsonb_build_array(v_out->>'transaction_id');
       END IF;
     ELSE
       v_review:=v_review+1;
     END IF;
   EXCEPTION WHEN OTHERS THEN
     -- PL/pgSQL exception blocks are subtransactions, rolling back *this*
     -- attempted registration but preserving successfully committed siblings.
     v_errors:=v_errors+1;
     v_review:=v_review+1;
     RAISE NOTICE 'BANK_ASSISTANT_ITEM_HELD_FOR_REVIEW (batch item %, SQLSTATE %)',v_total,SQLSTATE;
   END;
 END LOOP;
 RETURN jsonb_build_object(
   'processed',v_total,'registered',v_registered,'duplicate',v_duplicates,
   'review',v_review,'errors',v_errors,'usd',v_usd,'khr',v_khr,
   'rows',v_rows,'duplicate_ids',v_dup_ids
 );
END;
$function$;
REVOKE ALL ON FUNCTION public.bb_bank_assistant_auto_process_batch_v1(text,bigint,text,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bb_bank_assistant_auto_process_batch_v1(text,bigint,text,text,integer)
 TO service_role;
