export {
  engagementOf,
  isInWindow,
  shareOfVoice,
  summarizeWindow,
  type PageWindowStats,
  type PostStat,
  type ShareOfVoice,
  type VoiceInput,
  type VoiceShare,
  type Window,
} from "./engagement.js";

export {
  compareGap,
  compareWithStrongest,
  type GapBreakdown,
  type GapFactor,
  type GapFactorKey,
  type GapResult,
  type GapSide,
  type GapUnavailable,
} from "./gap.js";

export {
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MAX_COMMENTS,
  DEFAULT_MAX_POSTS,
  ListeningSync,
  dateKeyUtc,
  type FetchedComment,
  type FetchedPost,
  type ListeningRepository,
  type ListeningSyncOptions,
  type PageSyncResult,
  type TrackedKind,
  type TrackedPageRef,
  type TrackedSource,
} from "./ingest.js";

export {
  QUESTION_MARKERS,
  TOPICS,
  TOPIC_EXCEPTIONS,
  analyzeComment,
  normalizeForTopics,
  tallyTopics,
  type CommentAnalysis,
  type TopicDef,
  type TopicKey,
  type TopicSummary,
  type TopicTally,
} from "./topics.js";

export {
  fanBoards,
  overlapAcrossPages,
  topFansOfPage,
  type CommentAuthor,
  type FanBoard,
  type OverlapPerson,
  type OverlapResult,
  type TopFan,
} from "./fans.js";
