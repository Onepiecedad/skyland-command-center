import { vi, beforeAll, afterAll, expect } from 'vitest';

// Mock environment variables.
// These run before any test module (and therefore before config.ts / dotenv)
// is imported, so the deterministic test token is what the app validates
// against. dotenv.config() does not override already-set process.env vars,
// so a real backend/.env cannot clobber these during tests.
process.env.NODE_ENV = 'test';
process.env.PORT = '3002';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SCC_API_TOKEN = 'test-token-abc123';
process.env.LLM_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.LLM_MODEL = 'gpt-4o';
process.env.AUTH_SESSION_SECRET = 'test-session-secret';
// Webhook-tokens: sätts deterministiskt så pre-auth-routrarna valideras mot ett
// känt värde i stället för det som råkar ligga i backend/.env.
process.env.LEADS_INTAKE_TOKEN = 'test-token-abc123';

// Global test setup
beforeAll(() => {
  // Setup code that runs before all tests
});

afterAll(() => {
  // Cleanup code that runs after all tests
});

// Extend matchers if needed
expect.extend({
  // Custom matchers can be added here
});

// Mock console methods in test environment (optional)
// global.console = {
//   ...console,
//   // Uncomment to suppress specific log levels during tests
//   // log: vi.fn(),
//   // warn: vi.fn(),
//   // error: vi.fn(),
// };

// Use vi to avoid unused import warning
export { vi };
