-- Migration: sequences.outbound_policy (stabiliseringsplan fas 1, fynd 4).
-- Kill switchen (OUTBOUND_ENABLED=false / OUTBOUND_MODE=shadow) är en grind för
-- OUTREACH (kalla mejl, reaktivering). Den stoppade även bokningspåminnelserna
-- till folk som själva bokat ett möte — det är transaktionell post som ska gå ut.
--
--   outreach      = standard. Lyder OUTBOUND_ENABLED, OUTBOUND_MODE, dagsbudget,
--                   hela suppressionslistan.
--   transactional = går ut oavsett kill switch/skuggläge/dagsbudget. Lyder bara
--                   TRANSACTIONAL_OUTBOUND_ENABLED (default true) och
--                   suppressionsträffar som inte är 'existing_customer'
--                   (studsar, klagomål, avböjda stoppar fortfarande).
alter table sequences
  add column if not exists outbound_policy text not null default 'outreach'
  check (outbound_policy in ('outreach', 'transactional'));
comment on column sequences.outbound_policy is
  'outreach = lyder kill switch/skugga/dagsbudget; transactional = bokningspåminnelser o.dyl., går ut ändå.';

-- Strategisamtal-påminnelserna är transaktionella: mottagaren har själv bokat.
update sequences set outbound_policy = 'transactional'
 where trigger_type = 'booking_created' and name ilike '%påminnelse%';
