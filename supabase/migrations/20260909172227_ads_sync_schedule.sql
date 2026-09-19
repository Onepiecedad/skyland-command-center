-- Återskapad 2026-09-17 ur fjärrdatabasens migrationshistorik.
-- Migrationen kördes direkt mot databasen och fanns inte i repot. Innehållet är
-- ordagrant det som faktiskt applicerades; arkivet ligger i _arkiv/fjarrhistorik_2026-09-17.csv.

-- Daglig hämtning av egna annonssiffror.
--
-- Fönstret är tre dagar bakåt, inte bara gårdagen: Meta räknar om resultat i
-- efterhand när attributionsfönstret stänger, så gårdagens siffra är inte
-- slutgiltig. upsert på (platform, ad_id, date) gör omhämtningen gratis.
--
-- Nyckeln ligger i vault, inte i jobbet. Saknas den gör funktionen ingenting
-- och loggar det, i stället för att skicka ett anrop som ändå nekas.

create or replace function ads_sync_daglig()
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
    nyckel text;
    fran   date := current_date - 3;
    till   date := current_date - 1;
begin
    select decrypted_secret into nyckel
      from vault.decrypted_secrets where name = 'ADS_SYNC_KEY' limit 1;

    if nyckel is null then
        raise notice 'ads_sync: ADS_SYNC_KEY saknas i vault, hoppar över';
        return;
    end if;

    perform net.http_post(
        url := 'https://wfwqjxsuvbacvcmpiesl.supabase.co/functions/v1/ads-sync'
               || '?from=' || fran::text || '&to=' || till::text,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-ads-key', nyckel),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
end $$;

comment on function ads_sync_daglig is
'Anropar ads-sync för de tre senaste dagarna. Läser ADS_SYNC_KEY ur vault; utan den gör den ingenting.';

select cron.schedule('ads_sync_daglig', '15 6 * * *', 'select ads_sync_daglig();');
