import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  resolveDefaultConfigCandidates,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers ESPADA_OAUTH_DIR over ESPADA_STATE_DIR", () => {
    const env = {
      ESPADA_OAUTH_DIR: "/custom/oauth",
      ESPADA_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from ESPADA_STATE_DIR when unset", () => {
    const env = {
      ESPADA_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("prefers ESPADA_STATE_DIR over legacy state dir env", () => {
    const env = {
      ESPADA_STATE_DIR: "/new/state",
      ESPADA_STATE_DIR: "/legacy/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("orders default config candidates as new then legacy", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    expect(candidates[0]).toBe(path.join(home, ".espada", "espada.json"));
    expect(candidates[1]).toBe(path.join(home, ".espada", "espada.json"));
    expect(candidates[2]).toBe(path.join(home, ".espada", "espada.json"));
    expect(candidates[3]).toBe(path.join(home, ".espada", "espada.json"));
  });

  it("prefers ~/.espada when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "espada-state-"));
    try {
      const newDir = path.join(root, ".espada");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing legacy filename when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "espada-config-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousHomeDrive = process.env.HOMEDRIVE;
    const previousHomePath = process.env.HOMEPATH;
    const previousEspadaConfig = process.env.ESPADA_CONFIG_PATH;
    const previousEspadaConfig = process.env.ESPADA_CONFIG_PATH;
    const previousEspadaState = process.env.ESPADA_STATE_DIR;
    const previousEspadaState = process.env.ESPADA_STATE_DIR;
    try {
      const legacyDir = path.join(root, ".espada");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "espada.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      process.env.HOME = root;
      if (process.platform === "win32") {
        process.env.USERPROFILE = root;
        const parsed = path.win32.parse(root);
        process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
        process.env.HOMEPATH = root.slice(parsed.root.length - 1);
      }
      delete process.env.ESPADA_CONFIG_PATH;
      delete process.env.ESPADA_CONFIG_PATH;
      delete process.env.ESPADA_STATE_DIR;
      delete process.env.ESPADA_STATE_DIR;

      vi.resetModules();
      const { CONFIG_PATH } = await import("./paths.js");
      expect(CONFIG_PATH).toBe(legacyPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousHomeDrive === undefined) delete process.env.HOMEDRIVE;
      else process.env.HOMEDRIVE = previousHomeDrive;
      if (previousHomePath === undefined) delete process.env.HOMEPATH;
      else process.env.HOMEPATH = previousHomePath;
      if (previousEspadaConfig === undefined) delete process.env.ESPADA_CONFIG_PATH;
      else process.env.ESPADA_CONFIG_PATH = previousEspadaConfig;
      if (previousEspadaConfig === undefined) delete process.env.ESPADA_CONFIG_PATH;
      else process.env.ESPADA_CONFIG_PATH = previousEspadaConfig;
      if (previousEspadaState === undefined) delete process.env.ESPADA_STATE_DIR;
      else process.env.ESPADA_STATE_DIR = previousEspadaState;
      if (previousEspadaState === undefined) delete process.env.ESPADA_STATE_DIR;
      else process.env.ESPADA_STATE_DIR = previousEspadaState;
      await fs.rm(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "espada-config-override-"));
    try {
      const legacyDir = path.join(root, ".espada");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "espada.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { ESPADA_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "espada.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
