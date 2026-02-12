import { vi, beforeAll, afterAll, expect } from 'vitest';

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3002';

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
