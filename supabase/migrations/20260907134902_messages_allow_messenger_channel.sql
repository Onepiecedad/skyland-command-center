-- messages.channel tillät chat, voice, email, sms, whatsapp, webhook, instagram.
-- Messenger saknades trots att instagram, dess syskonkanal hos Meta, redan fanns.
-- Additiv ändring: inga befintliga rader påverkas.
alter table messages drop constraint messages_channel_check;
alter table messages add constraint messages_channel_check
  check (channel = any (array['chat','voice','email','sms','whatsapp','messenger','webhook','instagram']));;
