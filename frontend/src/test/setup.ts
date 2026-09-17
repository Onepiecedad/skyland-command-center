import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Utökar expect med jest-doms matchare OCH deras typer. Den gamla raden,
// expect.extend(matchers), gjorde bara det första: matcharna fanns när testerna
// kördes, men tsc kände inte till dem. Följden var att `npm test` lyste grönt medan
// `npm run build`, som kör `tsc && vite build`, föll på fem TS2339 i två testfiler.
//
// Det stoppade hela Docker-bygget, och därmed frontend-deployen, utan att någon
// märkte det: CI kör vitest, inte bygget. Subimporten nedan gör båda delarna i ett.
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  disconnect: vi.fn(),
  observe: vi.fn(),
  unobserve: vi.fn(),
  takeRecords: vi.fn(() => []),
  root: null,
  rootMargin: '',
  thresholds: [],
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
