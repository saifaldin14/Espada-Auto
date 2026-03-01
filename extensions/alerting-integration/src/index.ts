// ─── Barrel exports ───────────────────────────────────────────────────
export * from "./types.js";
export {
  detectProvider,
  parsePagerDuty,
  parseOpsGenie,
  parseCloudWatch,
  parseWebhook,
  resetAlertCounter,
} from "./parsers.js";
export type { ParseResult } from "./parsers.js";
export {
  formatAlertMessage,
  resolveTemplate,
  buildMessage,
  dispatchToChannel,
  dispatchToChannels,
  defaultSender,
  resetDispatchCounter,
} from "./dispatcher.js";
export type { ChannelSender } from "./dispatcher.js";
export {
  evaluateCondition,
  evaluateRule,
  resolveRoutes,
  shouldSuppress,
  filterAlerts,
  buildDashboard,
  ingestAlert,
} from "./router.js";
export type { RouteMatch, IngestResult } from "./router.js";
export {
  createAlertingTools,
  getAlertStore,
  getRouteStore,
  getChannelStore,
  getDispatchStore,
  clearStores,
  resetToolCounters,
  setSender,
  getSender,
  resetSender,
} from "./tools.js";
