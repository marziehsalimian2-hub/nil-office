-- =====================================================================
-- NIL Office — 0049_project_task_attach_entity.sql
-- Project & Task Management — widen attach_entity so Documents/
-- Attachments can hang off a Project or a Task. Isolated migration: a
-- new enum value cannot be used in the same transaction it's added in
-- — same reasoning as every prior enum-widening migration
-- (0020/0029/0036).
-- =====================================================================

alter type public.attach_entity add value if not exists 'PROJECT';
alter type public.attach_entity add value if not exists 'TASK';
