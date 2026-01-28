import { describe, expect, it } from "vitest";

import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "espada", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "espada", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "espada", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "espada", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "espada", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "espada", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "espada", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "espada"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "espada", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "espada", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "espada", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "espada", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "espada", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "espada", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "espada", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "espada", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "espada", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "espada", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "espada", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "espada", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "espada", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "espada", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["node", "espada", "status"],
    });
    expect(nodeArgv).toEqual(["node", "espada", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["node-22", "espada", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "espada", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["node-22.2.0.exe", "espada", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "espada", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["node-22.2", "espada", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "espada", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["node-22.2.exe", "espada", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "espada", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["/usr/bin/node-22.2.0", "espada", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "espada", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["nodejs", "espada", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "espada", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["node-dev", "espada", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "espada", "node-dev", "espada", "status"]);

    const directArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["espada", "status"],
    });
    expect(directArgv).toEqual(["node", "espada", "status"]);

    const bunArgv = buildParseArgv({
      programName: "espada",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "espada",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "espada", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "espada", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "espada", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "espada", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "espada", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "espada", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "espada", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "espada", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
