export {
  ServiceMeshManager,
  type MeshAdapter,
  type MeshProvider,
  type MeshService,
  type TrafficRoute,
  type RouteMatch,
  type WeightedDestination,
  type RetryPolicy,
  type FaultInjection,
  type CircuitBreakerConfig,
  type AuthorizationPolicy,
  type AuthzRule,
  type TrafficMetrics,
  type CanaryDeployment,
  type ProtocolType,
} from "./service-mesh.js";

export { IstioMeshAdapter } from "./istio-adapter.js";
export { LinkerdMeshAdapter } from "./linkerd-adapter.js";
export { LocalMeshAdapter } from "./local-adapter.js";
