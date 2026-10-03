-- Volta a 20261007100000: os áudios perdem o texto transcrito e a marca, e a
-- gravação do robô sai. A VPS com o transcritor ligado passa a falhar a
-- gravação (log `audio.transcript_record_failed`) sem afetar o resto: desligue
-- `NUCLEO_TRANSCRIBE` antes, se for de vez.
begin;

update public.whatsapp_messages
set content = ''
where transcribed_at is not null;

drop function if exists public.nucleo_message_transcript_record(jsonb);
drop function if exists public.nucleo_message_transcript_pending(jsonb);

alter table public.whatsapp_messages drop column if exists transcribed_at;

commit;
