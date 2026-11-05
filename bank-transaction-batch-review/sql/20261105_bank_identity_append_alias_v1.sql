-- BIG BROTHER Bank Review V2: append-only bank payer aliases.
-- Never overwrite customer_id, account_holder_name, account_number, bank_name,
-- active, existing aliases or any Bank Register/payment history.
CREATE OR REPLACE FUNCTION public.bb_customer_bank_identity_add_alias_v1(
 p_customer_id text,
 p_identity_id bigint,
 p_alias_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
 v_bank public.bb_customer_bank_identities%ROWTYPE;
 v_alias text:=btrim(coalesce(p_alias_name,''));
 v_norm text;
 v_existing boolean;
 v_aliases text[];
BEGIN
 IF NOT public.bb_is_admin() THEN
  RAISE EXCEPTION 'Only an active BIG BROTHER administrator may save bank payer aliases';
 END IF;
 IF p_identity_id IS NULL OR nullif(btrim(coalesce(p_customer_id,'')),'') IS NULL
   OR length(v_alias) NOT BETWEEN 2 AND 140
   OR v_alias ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Select an existing bank identity and a valid payer name';
 END IF;
 v_norm:=lower(regexp_replace(translate(v_alias,'.,-_','    '),'[[:space:]]+',' ','g'));
 IF length(v_norm)<2 THEN RAISE EXCEPTION 'Invalid payer alias'; END IF;

 -- Prevent concurrent admins assigning the same alias to different accounts.
 PERFORM pg_advisory_xact_lock(hashtext('BB_BANK_PAYER_ALIAS_V1_'||v_norm));

 SELECT * INTO v_bank
 FROM public.bb_customer_bank_identities b
 WHERE b.identity_id=p_identity_id
   AND b.customer_id=p_customer_id
   AND b.active=true
 FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Choose an active bank identity belonging to the selected customer';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.customers c
   WHERE c.customer_id=p_customer_id AND c.active=true
 ) THEN RAISE EXCEPTION 'The selected customer is inactive'; END IF;

 -- Company staff deposit on behalf of customers; such a payer must be one-time.
 IF EXISTS(
   SELECT 1 FROM public.staff s
   WHERE lower(regexp_replace(translate(btrim(coalesce(s.staff_name,'')),
     '.,-_','    '),'[[:space:]]+',' ','g'))=v_norm
     AND lower(btrim(coalesce(s.status,''))) NOT IN ('inactive','resigned','terminated','left')
 ) THEN
  RAISE EXCEPTION 'Company staff payer: use Register Once; do not create a permanent customer alias';
 END IF;

 -- Prevent wrong customer/identity mapping, including within the same customer.
 IF EXISTS(
   SELECT 1 FROM public.bb_customer_bank_identities b
   WHERE b.active=true AND b.identity_id<>p_identity_id
     AND (
       lower(regexp_replace(translate(btrim(b.account_holder_name),
        '.,-_','    '),'[[:space:]]+',' ','g'))=v_norm
       OR EXISTS(
         SELECT 1 FROM unnest(coalesce(b.alternative_names,ARRAY[]::text[])) x(name)
         WHERE lower(regexp_replace(translate(btrim(x.name),
           '.,-_','    '),'[[:space:]]+',' ','g'))=v_norm
       )
     )
 ) THEN
   RAISE EXCEPTION 'Payer name is already linked to another bank identity: use Register Once or review the existing directory';
 END IF;

 v_existing:=
   lower(regexp_replace(translate(btrim(v_bank.account_holder_name),
      '.,-_','    '),'[[:space:]]+',' ','g'))=v_norm
   OR EXISTS(
     SELECT 1 FROM unnest(coalesce(v_bank.alternative_names,ARRAY[]::text[])) x(name)
     WHERE lower(regexp_replace(translate(btrim(x.name),
       '.,-_','    '),'[[:space:]]+',' ','g'))=v_norm
   );
 IF NOT v_existing THEN
   UPDATE public.bb_customer_bank_identities b
   SET alternative_names=array_append(coalesce(b.alternative_names,ARRAY[]::text[]),v_alias),
     updated_at=now(),updated_by=auth.uid()
   WHERE b.identity_id=p_identity_id AND b.customer_id=p_customer_id AND b.active=true
   RETURNING b.alternative_names INTO v_aliases;
 ELSE
   v_aliases:=v_bank.alternative_names;
 END IF;

 RETURN jsonb_build_object(
   'identity_id',p_identity_id,
   'customer_id',v_bank.customer_id,
   'bank_name',v_bank.bank_name,
   'account_holder_name',v_bank.account_holder_name,
   'alternative_names',to_jsonb(v_aliases),
   'new_alias_added',NOT v_existing,
   'original_holder_unchanged',true
 );
END;
$func$;
REVOKE ALL ON FUNCTION public.bb_customer_bank_identity_add_alias_v1(text,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bb_customer_bank_identity_add_alias_v1(text,bigint,text)
 TO authenticated;
