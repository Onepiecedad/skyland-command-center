import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../services/supabase';

const router = Router();

const customerConfigSchema = z.object({
    config: z.record(z.string(), z.unknown())
});

// GET / - list customers with derived status
router.get('/', async (req: Request, res: Response) => {
    try {
        const { slug } = req.query;

        let query = supabase.from('customer_status').select('*');

        if (typeof slug === 'string' && slug.length > 0) {
            query = query.eq('slug', slug);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching customers:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ customers: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /:id - single customer by ID
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('customer_status')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Customer not found' });
            }
            console.error('Error fetching customer:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ customer: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /:id - update customer config
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const parsed = customerConfigSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: parsed.error.issues
            });
        }

        // Check if customer exists
        const { data: existing, error: checkError } = await supabase
            .from('customers')
            .select('id')
            .eq('id', id)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Update only the config field
        const { data, error } = await supabase
            .from('customers')
            .update({ config: parsed.data.config })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating customer:', error);
            return res.status(500).json({ error: error.message });
        }

        return res.json({ customer: data });
    } catch (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
