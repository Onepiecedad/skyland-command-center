alter table sequences
  add column if not exists outbound_policy text not null default 'outreach'
  check (outbound_policy in ('outreach', 'transactional'));
comment on column sequences.outbound_policy is
  'outreach = lyder kill switch/skugga/dagsbudget; transactional = bokningspåminnelser o.dyl., går ut ändå.';
update sequences set outbound_policy = 'transactional'
 where trigger_type = 'booking_created' and name ilike '%påminnelse%';;
