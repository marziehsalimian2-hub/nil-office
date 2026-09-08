-- =====================================================================
-- NIL Office — 0067_trade_upload_requires_interest.sql
-- Trade Portal — UI-test finding: LOI/ICPO upload must be conditioned on
-- the buyer's own latest response, not just the document deadline.
--   * latest response = INTERESTED -> upload allowed until document_deadline,
--     even after interest_deadline itself has passed.
--   * no response, or latest = NOT_INTERESTED, or latest =
--     REQUEST_MORE_TIME with no admin deadline extension -> upload
--     refused, server-side (not just hidden in the UI).
-- Pure `create or replace function` changes — no new tables/columns, no
-- migration of existing rows needed (both functions are already
-- SECURITY DEFINER and re-derive everything fresh on every call).
-- =====================================================================

create or replace function public.trade_get_buyer_view(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign public.trade_offer_buyers;
  v_offer  public.trade_offers;
  v_first_view boolean;
  v_latest public.trade_offer_responses;
  v_eff text;
begin
  select * into v_assign from public.trade_offer_buyers where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  end if;
  if v_assign.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ACCESS_REVOKED');
  end if;
  if now() > v_assign.token_expires_at then
    return jsonb_build_object('ok', false, 'error', 'ACCESS_EXPIRED');
  end if;

  select * into v_offer from public.trade_offers where id = v_assign.offer_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  end if;
  if v_offer.status = 'DRAFT' then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_PUBLISHED');
  end if;

  v_eff := public.trade_offer_effective_status(v_offer.status, v_offer.document_deadline);

  v_first_view := (v_assign.last_viewed_at is null);
  update public.trade_offer_buyers set last_viewed_at = now() where id = v_assign.id;
  if v_first_view then
    insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type)
    values (v_offer.id, v_assign.id, 'OFFER_VIEWED', 'BUYER');
  end if;

  select * into v_latest from public.trade_offer_responses
   where buyer_assignment_id = v_assign.id order by created_at desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'state', v_eff,
    'offer', jsonb_build_object(
      'offer_code', v_offer.offer_code,
      'title', v_offer.title,
      'product_name', v_offer.product_name,
      'product_type', v_offer.product_type,
      'quantity', v_offer.quantity,
      'unit', v_offer.unit,
      'price', v_offer.price,
      'currency_code', v_offer.currency_code,
      'price_basis', v_offer.price_basis,
      'origin', v_offer.origin,
      'delivery_location', v_offer.delivery_location,
      'delivery_terms', v_offer.delivery_terms,
      'payment_terms', v_offer.payment_terms,
      'description', v_offer.description,
      'terms_and_conditions', v_offer.terms_and_conditions,
      'interest_deadline', v_offer.interest_deadline,
      'document_deadline', v_offer.document_deadline,
      'timezone', v_offer.timezone,
      'interest_open', (v_eff = 'ACTIVE' and now() <= v_offer.interest_deadline),
      'document_open', (v_eff = 'ACTIVE' and now() <= v_offer.document_deadline),
      'upload_allowed', (
        v_eff = 'ACTIVE' and now() <= v_offer.document_deadline
        and coalesce(v_latest.response_type, '') = 'INTERESTED'
      )
    ),
    'assignment', jsonb_build_object(
      'viewed_before', not v_first_view,
      'latest_response_type', v_latest.response_type,
      'latest_response_at', v_latest.created_at
    )
  );
end;
$$;

create or replace function public.trade_record_document_upload(
  p_token_hash text,
  p_document_id uuid,
  p_document_type text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign public.trade_offer_buyers;
  v_offer  public.trade_offers;
  v_eff text;
  v_latest_response text;
begin
  if p_document_type not in ('LOI','ICPO') then
    raise exception 'INVALID_DOCUMENT_TYPE' using errcode = '22000';
  end if;

  select * into v_assign from public.trade_offer_buyers where token_hash = p_token_hash;
  if not found then
    raise exception 'TOKEN_INVALID' using errcode = '22000';
  end if;
  if v_assign.revoked_at is not null then
    raise exception 'ACCESS_REVOKED' using errcode = '22000';
  end if;
  if now() > v_assign.token_expires_at then
    raise exception 'TOKEN_EXPIRED' using errcode = '22000';
  end if;

  select * into v_offer from public.trade_offers where id = v_assign.offer_id for update;
  v_eff := public.trade_offer_effective_status(v_offer.status, v_offer.document_deadline);
  if v_eff <> 'ACTIVE' then
    raise exception 'OFFER_NOT_ACTIVE' using errcode = '22000';
  end if;
  if now() > v_offer.document_deadline then
    raise exception 'DOCUMENT_DEADLINE_PASSED' using errcode = '22000';
  end if;

  -- UI-test finding: upload is gated on the buyer's own latest response
  -- being INTERESTED — a bare REQUEST_MORE_TIME, NOT_INTERESTED, or no
  -- response at all must never unlock the upload form, regardless of
  -- where the deadlines stand. Only the buyer's stated interest does.
  select response_type into v_latest_response
    from public.trade_offer_responses
   where buyer_assignment_id = v_assign.id
   order by created_at desc limit 1;
  if v_latest_response is distinct from 'INTERESTED' then
    raise exception 'INTEREST_REQUIRED_FOR_UPLOAD' using errcode = '22000';
  end if;

  insert into public.trade_offer_documents
    (id, offer_id, buyer_assignment_id, document_type, storage_path, file_name, mime_type, size_bytes)
  values
    (p_document_id, v_offer.id, v_assign.id, p_document_type, p_storage_path, p_file_name, p_mime_type, p_size_bytes);

  insert into public.trade_offer_events (offer_id, buyer_assignment_id, event_type, actor_type, metadata)
  values (v_offer.id, v_assign.id, 'DOCUMENT_UPLOADED', 'BUYER', jsonb_build_object('document_type', p_document_type, 'document_id', p_document_id));
end;
$$;

-- =====================================================================
-- ROLLBACK — re-run 0066_trade_portal.sql's original bodies for these
-- two functions (drop the upload_allowed field and the INTERESTED
-- check) if this behavior ever needs to be reverted. No tables/columns
-- were added, so there is nothing else to drop.
-- =====================================================================
