import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabase';
import { costsQuerySchema, costEntrySchema } from '../schemas/costs';


const router = Router();

// Budget constant (later could be moved to a settings table)
const COST_BUDGET_USD = 150;

// GET / - aggregated cost data for the Cost Center dashboard
router.get('/', async (req: Request, res: Response) => {
    try {
        const parsed = costsQuerySchema.safeParse(req.query);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { range } = parsed.data;
        const days = range === '7d' ? 7 : 30;
        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split('T')[0];

        // Fetch all cost rows for the date range
        const { data: rows, error } = await supabase
            .from('costs')
            .select('date, provider, agent, cost_usd, call_count')
            .gte('date', sinceStr)
            .order('date', { ascending: true });

        if (error) {
            console.error('Error fetching costs:', error);
            return res.status(500).json({ error: error.message });
        }

        const costRows = rows || [];

        // --- Aggregate by date ---
        const dailyMap = new Map<string, { total: number; providers: Record<string, number> }>();
        for (const row of costRows) {
            const d = row.date;
            if (!dailyMap.has(d)) {
                dailyMap.set(d, { total: 0, providers: {} });
            }
            const entry = dailyMap.get(d)!;
            const cost = Number(row.cost_usd);
            entry.total += cost;
            entry.providers[row.provider] = (entry.providers[row.provider] || 0) + cost;
        }

        // Fill in missing dates with zeros
        const daily: Array<{ date: string; total: number; providers: Record<string, number> }> = [];
        const cursor = new Date(since);
        const today = new Date();
        while (cursor <= today) {
            const dateStr = cursor.toISOString().split('T')[0];
            const entry = dailyMap.get(dateStr);
            daily.push({
                date: dateStr,
                total: entry ? +entry.total.toFixed(2) : 0,
                providers: entry ? Object.fromEntries(
                    Object.entries(entry.providers).map(([k, v]) => [k, +v.toFixed(2)])
                ) : {}
            });
            cursor.setDate(cursor.getDate() + 1);
        }

        // --- Aggregate by provider ---
        const providerTotals: Record<string, number> = {};
        for (const row of costRows) {
            providerTotals[row.provider] = (providerTotals[row.provider] || 0) + Number(row.cost_usd);
        }

        const grandTotal = Object.values(providerTotals).reduce((a, b) => a + b, 0);

        const providers = Object.entries(providerTotals)
            .map(([provider, total]) => ({
                provider,
                total: +total.toFixed(2),
                percentage: grandTotal > 0 ? +((total / grandTotal) * 100).toFixed(1) : 0,
            }))
            .sort((a, b) => b.total - a.total);

        // --- Aggregate by agent ---
        const agentTotals: Record<string, { total: number; calls: number }> = {};
        for (const row of costRows) {
            if (!agentTotals[row.agent]) {
                agentTotals[row.agent] = { total: 0, calls: 0 };
            }
            agentTotals[row.agent].total += Number(row.cost_usd);
            agentTotals[row.agent].calls += (row.call_count || 1);
        }

        const agents = Object.entries(agentTotals)
            .map(([agent, data]) => ({
                agent,
                total: +data.total.toFixed(2),
                calls: data.calls,
            }))
            .sort((a, b) => b.total - a.total);

        return res.json({
            daily,
            providers,
            agents,
            monthTotal: +grandTotal.toFixed(2),
            budget: COST_BUDGET_USD
        });

    } catch (err) {
        console.error('Unexpected error fetching costs:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST / - log a cost entry
router.post('/', async (req: Request, res: Response) => {
    try {
        const parsed = costEntrySchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        const { data: created, error } = await supabase
            .from('costs')
            .insert(parsed.data)
            .select()
            .single();

        if (error) {
            console.error('Error inserting cost:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.status(201).json(created);

    } catch (err) {
        console.error('Unexpected error inserting cost:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
