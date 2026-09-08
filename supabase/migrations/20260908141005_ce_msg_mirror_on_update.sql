-- Tyst datafel: trg_ce_msg_mirror körde bara vid INSERT, så en status som gick
-- från sent till delivered/read, eller en kropp som fylldes i efterhand, nådde
-- aldrig kortet. Samma mönster som trg_ce_msg_windows redan använder.
drop trigger if exists trg_ce_msg_mirror on public.ce_messages;

create trigger trg_ce_msg_mirror
after insert or update of status, body, external_id, conversation_id, lead_id
on public.ce_messages
for each row execute function public.ce_msg_mirror_trg();
