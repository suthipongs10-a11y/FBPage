export {
  MetaGateway,
  resolveGraphVersion,
  normalizePath,
  DEFAULT_GRAPH_VERSION,
  DEFAULT_RETRY,
  DEFAULT_RATE_LIMIT,
  APP_SCOPE,
  type GatewayCallOptions,
  type GatewayResult,
  type GraphParams,
  type MetaGatewayConfig,
  type MetaGatewayDeps,
  type RateLimitConfig,
  type RetryPolicy,
} from "./gateway.js";

export {
  MetaApiError,
  MetaTransportError,
  classifyMetaError,
  RETRYABLE_CODES,
  type MetaErrorAction,
  type MetaErrorInfo,
  type MetaApiErrorInit,
} from "./errors.js";

export {
  TokenBucket,
  UsageGovernor,
  parseUsageHeader,
  parseBusinessUsageHeader,
  delayForUsagePct,
  THROTTLE_THRESHOLD_PCT,
  type TokenBucketOptions,
  type UsageGovernorOptions,
  type UsageReading,
  type UsageSnapshot,
} from "./rate-limit.js";

export { PageScheduler, type PageSchedulerOptions } from "./scheduler.js";

export {
  REQUIRED_PERMISSIONS,
  PERMISSION_DEPENDENCIES,
  FEATURE_PERMISSIONS,
  checkPermissions,
  expandWithDependencies,
  oauthScopeString,
  type PermissionGap,
  type RequiredPermission,
} from "./permissions.js";

export {
  TokenService,
  needsAlert,
  EXPIRY_WARNING_MS,
  type ConnectionState,
  type DebugTokenInfo,
  type ExchangedToken,
  type ManagedPage,
  type OAuthConfig,
  type PageConnectionHealth,
  type RawTokenResponse,
} from "./tokens.js";

export {
  createOAuthState,
  verifyOAuthState,
  OAuthStateError,
  OAUTH_STATE_TTL_MS,
  type OAuthStatePayload,
} from "./oauth-state.js";

export {
  SubscriptionService,
  REQUIRED_WEBHOOK_FIELDS,
  type WebhookSubscriptionStatus,
} from "./subscriptions.js";

export {
  noopCallLog,
  PRIORITY_WEIGHT,
  type CallLogEntry,
  type CallLogSink,
  type CallPriority,
  type HttpMethod,
  type PageToken,
  type TokenStore,
  type TokenType,
} from "./types.js";
