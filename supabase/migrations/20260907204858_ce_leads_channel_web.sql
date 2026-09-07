-- Ett lead fran ett webbformular har ingen konversationskanal. Att skriva 'email'
-- pastar att gasten mejlat, och bredvid Meta-leadsen dar kanalen faktiskt ar
-- ursprunget blir det direkt missvisande. 'web' sager sanningen: formularet pa
-- sajten. E-post och telefon star redan var for sig pa kortet.
-- Additivt: inget befintligt varde tas bort.
alter table ce_leads drop constraint ce_leads_channel_check;
alter table ce_leads add constraint ce_leads_channel_check
  check (channel = any (array['whatsapp','messenger','sms','email','web','other']));;
