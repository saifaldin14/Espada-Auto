import type { EspadaConfig } from "../config/config.js";

export type PluginEnableResult = {
  config: EspadaConfig;
  enabled: boolean;
  reason?: string;
};

function ensureAllowlisted(cfg: EspadaConfig, pluginId: string): EspadaConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) return cfg;
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}

export function enablePluginInConfig(cfg: EspadaConfig, pluginId: string): PluginEnableResult {
  if (cfg.plugins?.enabled === false) {
    return { config: cfg, enabled: false, reason: "plugins disabled" };
  }
  if (cfg.plugins?.deny?.includes(pluginId)) {
    return { config: cfg, enabled: false, reason: "blocked by denylist" };
  }

  const entries = {
    ...cfg.plugins?.entries,
    [pluginId]: {
      ...(cfg.plugins?.entries?.[pluginId] as Record<string, unknown> | undefined),
      enabled: true,
    },
  };
  let next: EspadaConfig = {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      entries,
    },
  };
  next = ensureAllowlisted(next, pluginId);
  return { config: next, enabled: true };
}
