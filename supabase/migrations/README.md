# supabase/migrations

Filerna här är hämtade direkt ur databasens egen migrationshistorik
(`supabase_migrations.schema_migrations`) den 7 september 2026, och varje fil
är verifierad mot databasens md5-summa vid nedskrivningen. Mappen beskriver
alltså projektet **skyland-command-center** (`wfwqjxsuvbacvcmpiesl`) rad för rad.

## Varför backfillen behövdes

Mappen innehöll sju handskrivna filer medan databasen hade 66 tillämpade
migrationer. Allt som byggts sedan augusti — Cold Experience-tabellerna,
statusmaskinen, RLS-isoleringen, mäklarvertikalen, aktivitetsbryggan och hela
CRM-speglingen — fanns bara i databasen. En ren miljö gick inte att bygga upp
från repot.

De sju gamla filerna är inte raderade utan flyttade till `_fore_backfill/`.
De var approximationer av några av migrationerna och skulle ha blivit
dubbletter i uppspelningen. `20260211_create_archive_files.sql` finns inte i
databasens historik alls och verkar ha körts vid sidan av migrationssystemet.

## Två migrationer som ser konstiga ut

`tmp_migrations_dump_for_backfill` och `tmp_migrations_dump_dropped` skapade
och tog bort en tillfällig funktion som användes för att göra just den här
backfillen. De är med för att historiken ska vara komplett och för att en
uppspelning ska gå igenom.

## Håll den uppdaterad

Varje ny migration som körs mot databasen ska läggas här med samma
namnkonvention: `<version>_<namn>.sql`, där versionen är exakt den som står i
`supabase_migrations.schema_migrations`. Glider de isär igen beskriver repot
inte längre systemet.
