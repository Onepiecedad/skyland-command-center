-- Skyland Command Center Seed Data v1.1
-- Initial customers and agent configuration (exact SPEC v1.1)
-- ============================================================================
-- CUSTOMERS
-- ============================================================================
INSERT INTO customers (name, slug)
VALUES ('Thomas - MarinMekaniker', 'thomas'),
    ('Axel - Hasselblads Livs', 'axel'),
    ('Gustav - Cold Experience', 'gustav');
-- ============================================================================
-- AGENT CONFIGS
-- ============================================================================
INSERT INTO agent_configs (
        agent_name,
        display_name,
        description,
        autonomy_defaults
    )
VALUES (
        'master_brain',
        'Master Brain',
        'Central koordinator för hela Skyland-systemet',
        '{"external_output": "SUGGEST", "internal_query": "ACT", "task_creation": "SUGGEST"}'
    );