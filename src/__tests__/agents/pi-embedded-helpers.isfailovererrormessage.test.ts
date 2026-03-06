import { describe, expect, it } from "vitest";
import { isFailoverErrorMessage } from "../../agents/pi-embedded-helpers.js";
import { DEFAULT_AGENTS_FILENAME } from "../../agents/workspace.js";

const _makeFile = (overrides: Partial<WorkspaceBootstrapFile>): WorkspaceBootstrapFile => ({
  name: DEFAULT_AGENTS_FILENAME,
  path: "/tmp/AGENTS.md",
  content: "",
  missing: false,
  ...overrides,
});
describe("isFailoverErrorMessage", () => {
  it("matches auth/rate/billing/timeout", () => {
    const samples = [
      "invalid api key",
      "429 rate limit exceeded",
      "Your credit balance is too low",
      "request timed out",
      "invalid request format",
    ];
    for (const sample of samples) {
      expect(isFailoverErrorMessage(sample)).toBe(true);
    }
  });
});
