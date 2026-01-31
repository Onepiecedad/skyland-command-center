-- Skyland Command Center Seed Data
-- Initial customers and agent configuration
-- ============================================================================
-- CUSTOMERS
-- ============================================================================
INSERT INTO customers (slug, name, domain, config)
VALUES (
        'thomas',
        'MarinMekaniker',
        'marinmekaniker.se',
        '{"industry": "marine", "tier": "standard"}'
    ),
    (
        'axel',
        'Hasselblads Livs',
        'hasselbladslivs.se',
        '{"industry": "retail", "tier": "premium"}'
    ),
    (
        'gustav',
        'Cold Experience',
        'coldexperience.se',
        '{"industry": "tourism", "tier": "standard"}'
    );
-- ============================================================================
-- AGENT CONFIGS
-- ============================================================================
INSERT INTO agent_configs (
        name,
        description,
        permissions,
        settings,
        is_active
    )
VALUES (
        'master_brain',
        'Central orchestration agent with controlled autonomy levels',
        '{
      "external_output": "SUGGEST",
      "internal_query": "ACT",
      "task_creation": "SUGGEST"
    }',
        '{
      "max_concurrent_tasks": 5,
      "escalation_threshold": 3,
      "auto_retry_failed": true
    }',
        true
    );