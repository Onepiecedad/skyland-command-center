/**
 * Test setup — runs before all tests.
 * Sets required env vars so supabase.ts doesn't throw.
 */

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SCC_API_TOKEN = 'test-token-abc123';
process.env.LLM_PROVIDER = 'openai';
process.env.LLM_MODEL = 'gpt-4o';
