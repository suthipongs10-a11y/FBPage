export {
  contentHash,
  normalizeContent,
  hashableFromPost,
  checkDuplicate,
  DUPLICATE_WINDOW_DAYS,
  DUPLICATE_WINDOW_MS,
  type DuplicateCheckResult,
  type DuplicateHit,
  type HashableContent,
  type PublishedPostLookup,
} from "./content-hash.js";

export {
  decideRetry,
  describeRetrySchedule,
  RETRY_SCHEDULE_MS,
  MAX_PUBLISH_ATTEMPTS,
  type DecideArgs,
  type PublishDecision,
} from "./retry-policy.js";

export { PostPublisher, PublishError } from "./publisher.js";

export {
  PublishWorker,
  noopPublishAlerts,
  type PostRepository,
  type PublishAlertSink,
  type PublishWorkerOptions,
} from "./worker.js";

export {
  PublishScheduler,
  publishJobKey,
  localTimeToUtcMs,
  utcMsToLocalText,
  type DuePostSource,
  type PublishQueue,
  type PublishSchedulerOptions,
} from "./scheduler.js";

export {
  computeBestTimes,
  MIN_SAMPLES_PER_SLOT,
  MIN_TOTAL_SAMPLES,
  type BestTimeResult,
  type PostPerformanceSample,
  type SlotScore,
  type TimeSlot,
} from "./best-time.js";

export type {
  MediaItem,
  PostContent,
  PostTarget,
  PostType,
  PublishJob,
  PublishOutcome,
  PublishStatus,
  PublishSuccess,
  ScheduledPost,
  SkipReason,
} from "./types.js";
