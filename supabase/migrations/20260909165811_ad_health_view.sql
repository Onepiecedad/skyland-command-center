-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Flaggningen. Rullar upp de senaste 30 dagarna per annons, hämtar det mest
-- specifika målet som gäller (annons > kampanj > kund) och sätter en färg.
--
-- Grått betyder "vet inte än": annonsen har inte spenderat upp till golvet.
-- Det är avsiktligt skilt från rött. Att pausa en annons som knappt fått
-- pengar är det vanligaste sättet att döda något som hade fungerat.

create or replace view ad_health as
with fonster as (
    select
        p.customer_id, p.platform, p.account_id,
        p.campaign_id, max(p.campaign_name) as campaign_name,
        p.ad_id,       max(p.ad_name)       as ad_name,
        count(*)                as days,
        min(p.date)             as first_date,
        max(p.date)             as last_date,
        sum(p.spend)            as spend,
        max(p.currency)         as currency,
        sum(p.impressions)      as impressions,
        sum(p.clicks)           as clicks,
        sum(p.link_clicks)      as link_clicks,
        sum(p.results)          as results,
        max(p.result_type)      as result_type,
        sum(p.video_3s)         as video_3s,
        sum(p.video_p100)       as video_p100,
        sum(p.video_plays)      as video_plays
    from ad_performance p
    where p.date >= current_date - interval '30 days'
    group by p.customer_id, p.platform, p.account_id, p.campaign_id, p.ad_id
),
med_mal as (
    select f.*,
           k.name as customer_name,
           m.target_cost, m.spend_floor, m.yellow_margin, m.scope as target_scope
    from fonster f
    join customers k on k.id = f.customer_id
    left join lateral (
        select t.* from ad_targets t
        where t.active and t.customer_id = f.customer_id
          and (
              (t.scope = 'ad'       and t.scope_id = f.ad_id)
           or (t.scope = 'campaign' and t.scope_id = f.campaign_id)
           or (t.scope = 'customer')
          )
        order by case t.scope when 'ad' then 1 when 'campaign' then 2 else 3 end
        limit 1
    ) m on true
)
select
    customer_id, customer_name, platform, account_id,
    campaign_id, campaign_name, ad_id, ad_name,
    days, first_date, last_date, currency,
    round(spend, 2)                                            as spend,
    impressions, clicks, link_clicks, results, result_type,
    round(clicks::numeric      / nullif(impressions, 0) * 100, 3) as ctr_pct,
    round(spend                / nullif(clicks, 0), 2)            as cpc,
    round(spend * 1000         / nullif(impressions, 0), 2)       as cpm,
    -- Hook rate: andelen som stannade tre sekunder. Bara meningsfull för video.
    round(video_3s::numeric    / nullif(impressions, 0) * 100, 2) as hook_rate_pct,
    -- Hold rate: av dem som stannade tre sekunder, hur många såg klart.
    round(video_p100::numeric  / nullif(video_3s, 0)    * 100, 2) as hold_rate_pct,
    round(spend                / nullif(results, 0), 2)           as cost_per_result,
    target_cost, spend_floor, yellow_margin, target_scope,
    case
        when target_cost is null                     then 'grey'
        when spend < coalesce(spend_floor, 0)        then 'grey'
        when coalesce(results, 0) = 0                then 'red'
        when spend / results <= target_cost          then 'green'
        when spend / results <= target_cost * (1 + coalesce(yellow_margin, 0.25)) then 'yellow'
        else 'red'
    end as status,
    case
        when target_cost is null then 'Inget mål satt för kunden'
        when spend < coalesce(spend_floor, 0)
            then 'Har spenderat ' || round(spend, 0) || ' av ' || round(spend_floor, 0) || ' innan den kan dömas'
        when coalesce(results, 0) = 0
            then 'Noll resultat efter ' || round(spend, 0) || ' i spend'
        when spend / results <= target_cost
            then round(spend / results, 0) || ' per resultat mot målet ' || round(target_cost, 0)
        when spend / results <= target_cost * (1 + coalesce(yellow_margin, 0.25))
            then round(spend / results, 0) || ' per resultat, över målet ' || round(target_cost, 0) || ' men inom marginalen'
        else round(spend / results, 0) || ' per resultat mot målet ' || round(target_cost, 0) || ', klart över'
    end as reason
from med_mal;

comment on view ad_health is
'Grönt/gult/rött per annons de senaste 30 dagarna. Grått = under spendgolvet, alltså för tidigt att döma.';
