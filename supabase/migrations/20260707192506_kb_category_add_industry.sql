-- Live-datan har kategorin 'industry' (KUNSKAPSBAS-branscher-v3) som saknades i repo-schemat
ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS knowledge_base_category_check;
ALTER TABLE knowledge_base ADD CONSTRAINT knowledge_base_category_check
  CHECK (category IN ('service', 'faq', 'case_study', 'tech', 'industry'));;
