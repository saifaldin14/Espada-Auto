import { describe, expect, it } from "vitest";

import { parseSystemdExecStart } from "./systemd-unit.js";

describe("parseSystemdExecStart", () => {
  it("splits on whitespace outside quotes", () => {
    const execStart = "/usr/bin/espada gateway start --foo bar";
    expect(parseSystemdExecStart(execStart)).toEqual([
      "/usr/bin/espada",
      "gateway",
      "start",
      "--foo",
      "bar",
    ]);
  });

  it("preserves quoted arguments", () => {
    const execStart = '/usr/bin/espada gateway start --name "My Bot"';
    expect(parseSystemdExecStart(execStart)).toEqual([
      "/usr/bin/espada",
      "gateway",
      "start",
      "--name",
      "My Bot",
    ]);
  });

  it("parses path arguments", () => {
    const execStart = "/usr/bin/espada gateway start --path /tmp/espada";
    expect(parseSystemdExecStart(execStart)).toEqual([
      "/usr/bin/espada",
      "gateway",
      "start",
      "--path",
      "/tmp/espada",
    ]);
  });
});
