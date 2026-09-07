-- IG DM är primär outreach-kanal — måste kunna loggas i messages.
alter table messages drop constraint messages_channel_check;
alter table messages add constraint messages_channel_check
  check (channel = any (array['chat'::text, 'voice'::text, 'email'::text, 'sms'::text, 'whatsapp'::text, 'webhook'::text, 'instagram'::text]));;
