-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Stänger loopen: annonsens kostnad möter vad den faktiskt gav i CRM:et.
--
-- Meta vet vad en annons kostade och hur många formulär som fylldes i, men
-- inget om vad som hände sedan. ce_leads vet vem som blev het, överlämnad och
-- bokad, men inget om vad det kostade. Kopplingen är ad_id, som är globalt
-- unikt hos Meta, så ingen tenant- eller kundnyckel behövs i joinen.
--
-- FULL OUTER med flit: en annons utan hämtade siffror ska synas med sina leads
-- (det är läget innan META_ADS_TOKEN är satt), och en annons utan leads ska
-- synas med sin spend. Att tysta den ena sidan skulle dölja precis det man
-- letar efter.

create or replace view ad_funnel as
with spend as (
    select ad_id,
           min(customer_id::text)  as customer_id,
           max(account_id)         as account_id,
           max(campaign_name)      as campaign_name,
           max(ad_name)            as ad_name,
           max(currency)           as currency,
           min(date)               as first_date,
           max(date)               as last_date,
           sum(p.spend)            as spend,
           sum(impressions)        as impressions,
           sum(clicks)             as clicks,
           sum(results)            as meta_results
    from ad_performance p
    group by ad_id
),
leads as (
    select ad_id,
           count(*)                                          as leads,
           count(*) filter (where hot_at is not null)         as heta,
           count(*) filter (where handed_off_at is not null)  as overlamnade,
           count(*) filter (where booked_at is not null)      as bokade,
           count(*) filter (where paid_at is not null)        as betalda,
           min(created_at)                                    as forsta_lead,
           max(created_at)                                    as senaste_lead
    from ce_leads
    where ad_id is not null
    group by ad_id
)
select
    coalesce(s.ad_id, l.ad_id)                     as ad_id,
    s.customer_id, s.account_id, s.campaign_name, s.ad_name, s.currency,
    s.first_date, s.last_date,
    round(s.spend, 2)                              as spend,
    s.impressions, s.clicks,
    s.meta_results,
    coalesce(l.leads, 0)                           as leads,
    coalesce(l.heta, 0)                            as heta,
    coalesce(l.overlamnade, 0)                     as overlamnade,
    coalesce(l.bokade, 0)                          as bokade,
    coalesce(l.betalda, 0)                         as betalda,
    l.forsta_lead, l.senaste_lead,
    -- De tre siffror som faktiskt styr var pengarna ska ligga. Meta kan bara
    -- räkna den första av dem.
    round(s.spend / nullif(l.leads, 0), 2)         as kostnad_per_lead,
    round(s.spend / nullif(l.heta, 0), 2)          as kostnad_per_het,
    round(s.spend / nullif(l.bokade, 0), 2)        as kostnad_per_bokning,
    -- Skillnaden mellan Metas resultaträkning och vår. Avviker de kraftigt
    -- läser vi fel actiontyp, eller så tappar intaget leads.
    case when s.meta_results is not null and l.leads is not null
         then s.meta_results - l.leads end        as diff_meta_mot_crm
from spend s
full outer join leads l on l.ad_id = s.ad_id;

comment on view ad_funnel is
'Annonskostnad möter CRM-utfall via ad_id. Rader utan spend = siffror inte hämtade än. Rader utan leads = annons utan formulärsintag.';
