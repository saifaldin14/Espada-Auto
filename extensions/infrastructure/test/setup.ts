/**
 * Test setup file
 */

import { vi } from "vitest";

// Global test setup
vi.stubGlobal("console", {
  ...console,
  debug: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: console.error,
});
