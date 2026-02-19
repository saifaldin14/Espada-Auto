import type { WebSocket } from "ws";

import type { ConnectParams } from "../protocol/index.js";
import type { SSOUser } from "../sso/types.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  /** Resolved SSO user identity (present when authenticated via SSO). */
  ssoUser?: SSOUser;
  /** SSO session ID (present when authenticated via SSO). */
  ssoSessionId?: string;
  /** Auth method used for this connection. */
  authMethod?: "token" | "password" | "tailscale" | "device-token" | "sso";
  /** Resolved RBAC roles for this connection. */
  roles?: string[];
};
