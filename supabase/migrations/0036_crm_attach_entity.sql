-- =====================================================================
-- NIL Office — 0036_crm_attach_entity.sql
-- CRM module — widen attach_entity so Documents/Attachments can hang off
-- a Company or an Opportunity (spec §25). Isolated migration: a new enum
-- value cannot be used in the same transaction it's added in — same
-- reasoning as 0020_contract_attach_entity.sql / 0029_sales_document_attach_entity.sql.
-- =====================================================================

alter type public.attach_entity add value if not exists 'COMPANY';
alter type public.attach_entity add value if not exists 'OPPORTUNITY';
