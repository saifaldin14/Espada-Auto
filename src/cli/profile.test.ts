import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs(["node", "espada", "gateway", "--dev", "--allow-unconfigured"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "espada", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "espada", "--dev", "gateway"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "espada", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "espada", "--profile", "work", "status"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "espada", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "espada", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "espada", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "espada", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".espada-dev");
    expect(env.ESPADA_PROFILE).toBe("dev");
    expect(env.ESPADA_STATE_DIR).toBe(expectedStateDir);
    expect(env.ESPADA_CONFIG_PATH).toBe(path.join(expectedStateDir, "espada.json"));
    expect(env.ESPADA_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      ESPADA_STATE_DIR: "/custom",
      ESPADA_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.ESPADA_STATE_DIR).toBe("/custom");
    expect(env.ESPADA_GATEWAY_PORT).toBe("19099");
    expect(env.ESPADA_CONFIG_PATH).toBe(path.join("/custom", "espada.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("espada doctor --fix", {})).toBe("espada doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("espada doctor --fix", { ESPADA_PROFILE: "default" })).toBe(
      "espada doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("espada doctor --fix", { ESPADA_PROFILE: "Default" })).toBe(
      "espada doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("espada doctor --fix", { ESPADA_PROFILE: "bad profile" })).toBe(
      "espada doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(formatCliCommand("espada --profile work doctor --fix", { ESPADA_PROFILE: "work" })).toBe(
      "espada --profile work doctor --fix",
    );
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("espada --dev doctor", { ESPADA_PROFILE: "dev" })).toBe(
      "espada --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("espada doctor --fix", { ESPADA_PROFILE: "work" })).toBe(
      "espada --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("espada doctor --fix", { ESPADA_PROFILE: "  jbespada  " })).toBe(
      "espada --profile jbespada doctor --fix",
    );
  });

  it("handles command with no args after espada", () => {
    expect(formatCliCommand("espada", { ESPADA_PROFILE: "test" })).toBe("espada --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm espada doctor", { ESPADA_PROFILE: "work" })).toBe(
      "pnpm espada --profile work doctor",
    );
  });
});
