import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".espada"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", ESPADA_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".espada-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", ESPADA_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".espada"));
  });

  it("uses ESPADA_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", ESPADA_STATE_DIR: "/var/lib/espada" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/espada"));
  });

  it("expands ~ in ESPADA_STATE_DIR", () => {
    const env = { HOME: "/Users/test", ESPADA_STATE_DIR: "~/espada-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/espada-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { ESPADA_STATE_DIR: "C:\\State\\espada" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\espada");
  });
});
