-- Desfaz 20261020110000_lista_de_conversas_com_contato.sql. Colar no SQL Editor.
--
-- Apaga a RPC da lista, os dois índices de chave de telefone e as duas funções
-- de telefone. O portal novo cai sozinho no caminho de hoje (a RPC some e ele
-- recebe PGRST202/42883). Nada mais depende delas.

begin;

drop function if exists public.nucleo_conversation_list(uuid, timestamptz, integer);
drop index if exists public.contacts_phone_key_idx;
drop index if exists public.whatsapp_conversations_phone_key_idx;
drop function if exists private.br_phone_key(text);
drop function if exists private.br_phone_normalize(text);

commit;
