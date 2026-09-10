/**
 * Annonsstatistik från Meta (SCC-58).
 *
 * Varför ser det ut så här: tokenet som får läsa Cold Experiences annonskonto
 * ligger i ~/.openclaw/.env på VPS:en, och SCC-backenden kör på Render. Render
 * kan inte läsa den filen, och en hemlighet som ligger på två ställen är en
 * hemlighet som förr eller senare bara roteras på det ena. Därför hämtar
 * VPS-Alex siffrorna och POSTar dem hit — samma riktning som claw-pollern och
 * `scc.py arkiv` redan går.
 *
 *   POST /sync      { ad_account_id, rows: [...] }  → upsert per dygn+kampanj
 *   GET  /?customer=gustav&days=7                    → sammanfattning + serie
 *
 * GET:et gör också avstämningen som är hela poängen: Meta räknar sina egna
 * leads, `ce_leads` innehåller de som faktiskt kom fram. Glider de isär är
 * något trasigt i inflödet, och det syns ingen annanstans.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

const radSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    campaign_id: z.string().min(1),
    campaign_name: z.string().nullish(),
    spend: z.number().nonnegative(),
    impressions: z.number().int().nonnegative(),
    clicks: z.number().int().nonnegative(),
    leads: z.number().int().nonnegative(),
    currency: z.string().max(8).optional(),
});

const syncSchema = z.object({
    customer_slug: z.string().min(1),
    ad_account_id: z.string().min(1),
    rows: z.array(radSchema).max(500),
});

// POST /sync — VPS:en levererar dygnsrader. Idempotent: samma dygn skrivs över.
router.post('/sync', async (req: Request, res: Response) => {
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'ogiltig payload', detaljer: parsed.error.flatten() });
    }
    const { customer_slug, ad_account_id, rows } = parsed.data;

    const { data: kund, error: kundErr } = await supabase
        .from('customers').select('id').eq('slug', customer_slug).maybeSingle();
    if (kundErr) return res.status(500).json({ error: kundErr.message });
    if (!kund) return res.status(404).json({ error: `okänd kund "${customer_slug}"` });

    if (rows.length === 0) return res.json({ ok: true, upserted: 0 });

    const { error } = await supabase.from('meta_ads_daily').upsert(
        rows.map(r => ({
            customer_id: kund.id,
            ad_account_id,
            date: r.date,
            campaign_id: r.campaign_id,
            campaign_name: r.campaign_name ?? null,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            leads: r.leads,
            currency: r.currency ?? 'SEK',
            fetched_at: new Date().toISOString(),
        })),
        { onConflict: 'customer_id,date,campaign_id' },
    );
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, upserted: rows.length });
});

export interface AdsSummary {
    customer: string;
    days: number;
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    cost_per_lead: number | null;
    currency: string;
    /**
     * Leads i CRM:t under samma period. null = kunden har ingen känd
     * lead-mottagare i systemet, och då finns ingenting att stämma av mot.
     * Att visa en nolla där vore en lögn som ser ut som ett larm.
     */
    leads_i_crm: number | null;
    /** Meta minus CRM. null när avstämning inte är möjlig. */
    tapp: number | null;
    campaigns: Array<{ campaign_name: string | null; spend: number; leads: number; cost_per_lead: number | null }>;
    daily: Array<{ date: string; spend: number; leads: number }>;
    last_fetched_at: string | null;
}

/** Sammanfattning för en kund. Delas av GET-routen och Alex-verktyget. */
export async function adsSummary(slug: string, days: number): Promise<AdsSummary | { error: string }> {
    const d = Math.min(Math.max(days, 1), 90);
    const { data: kund } = await supabase
        .from('customers').select('id, name, config').eq('slug', slug).maybeSingle();
    if (!kund) return { error: `Okänd kund "${slug}".` };

    // Var landar kundens leads? Cold Experience har ce_leads; andra kunder kan
    // sakna mottagare helt (klubben ringer leadsen direkt i Metas Leadcenter).
    // Utan explicit konfiguration stämmer vi inte av — förr räknade koden alltid
    // i ce_leads utan kundfilter, vilket hade gett nästa kund en påhittad siffra.
    const metaCfg = ((kund.config ?? {}) as Record<string, unknown>).meta as
        Record<string, unknown> | undefined;
    const mottagare = typeof metaCfg?.lead_sink === 'string' ? metaCfg.lead_sink : null;

    const sedan = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('meta_ads_daily')
        .select('date, campaign_name, spend, impressions, clicks, leads, currency, fetched_at')
        .eq('customer_id', kund.id)
        .gte('date', sedan)
        .order('date', { ascending: true });
    if (error) return { error: error.message };

    const rader = data ?? [];
    if (rader.length === 0) {
        return { error: `Ingen annonsdata för ${kund.name} de senaste ${d} dagarna. Har synken kört?` };
    }

    const tal = (v: unknown) => Number(v ?? 0) || 0;
    const spend = rader.reduce((s, r) => s + tal(r.spend), 0);
    const leads = rader.reduce((s, r) => s + tal(r.leads), 0);

    const perKampanj = new Map<string, { spend: number; leads: number }>();
    const perDag = new Map<string, { spend: number; leads: number }>();
    for (const r of rader) {
        const k = String(r.campaign_name ?? '—');
        const a = perKampanj.get(k) ?? { spend: 0, leads: 0 };
        perKampanj.set(k, { spend: a.spend + tal(r.spend), leads: a.leads + tal(r.leads) });
        const dag = String(r.date);
        const b = perDag.get(dag) ?? { spend: 0, leads: 0 };
        perDag.set(dag, { spend: b.spend + tal(r.spend), leads: b.leads + tal(r.leads) });
    }

    // Avstämningen: vad Meta räknade mot vad som faktiskt ligger i CRM:t.
    // Bara för kunder där vi VET var leadsen landar.
    let leadsICrm: number | null = null;
    if (mottagare === 'ce_leads') {
        const { count } = await supabase
            .from('ce_leads')
            .select('id', { count: 'exact', head: true })
            .eq('source', 'lead_ads')
            .gte('created_at', `${sedan}T00:00:00Z`);
        leadsICrm = count ?? 0;
    } else if (mottagare === 'contacts') {
        const { count } = await supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', kund.id)
            .gte('created_at', `${sedan}T00:00:00Z`);
        leadsICrm = count ?? 0;
    }

    const rundaKr = (v: number) => Math.round(v * 100) / 100;

    return {
        customer: kund.name,
        days: d,
        spend: rundaKr(spend),
        impressions: rader.reduce((s, r) => s + tal(r.impressions), 0),
        clicks: rader.reduce((s, r) => s + tal(r.clicks), 0),
        leads,
        cost_per_lead: leads > 0 ? rundaKr(spend / leads) : null,
        currency: String(rader[0]?.currency ?? 'SEK'),
        leads_i_crm: leadsICrm,
        tapp: leadsICrm === null ? null : leads - leadsICrm,
        campaigns: [...perKampanj.entries()]
            .map(([campaign_name, v]) => ({
                campaign_name,
                spend: rundaKr(v.spend),
                leads: v.leads,
                cost_per_lead: v.leads > 0 ? rundaKr(v.spend / v.leads) : null,
            }))
            .sort((a, b) => b.spend - a.spend),
        daily: [...perDag.entries()]
            .map(([date, v]) => ({ date, spend: rundaKr(v.spend), leads: v.leads })),
        last_fetched_at: rader.reduce<string | null>(
            (senast, r) => (!senast || String(r.fetched_at) > senast ? String(r.fetched_at) : senast), null),
    };
}

// GET /?customer=gustav&days=7
router.get('/', async (req: Request, res: Response) => {
    const slug = typeof req.query.customer === 'string' ? req.query.customer : '';
    if (!slug) return res.status(400).json({ error: 'customer krävs' });
    const days = parseInt(String(req.query.days ?? '7'), 10) || 7;
    const svar = await adsSummary(slug, days);
    if ('error' in svar) return res.status(404).json(svar);
    return res.json(svar);
});

export default router;
