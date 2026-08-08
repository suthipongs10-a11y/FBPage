export {
  BotEngine,
  retrievalConfidence,
  isContained,
  type AnswerResult,
  type BotEngineOptions,
  type KeywordRule,
  type LlmClient,
} from "./engine.js";

export {
  chunkText,
  prepareChunks,
  retrieve,
  buildContext,
  cosineSimilarity,
  keywordScore,
  TARGET_CHUNK_CHARS,
  CHUNK_OVERLAP_CHARS,
  DEFAULT_TOP_K,
  DEFAULT_MIN_SCORE,
  type Embedder,
  type RetrieveOptions,
} from "./knowledge.js";

export {
  buildSystemPrompt,
  applyTone,
  stripEmoji,
  checkBannedWords,
  botDisclosure,
  defaultConfig,
  type ToneViolation,
} from "./tone.js";

export {
  DEFAULT_TONE,
  type AnswerLayer,
  type BotContext,
  type BotReply,
  type KnowledgeChunk,
  type PageBotConfig,
  type RetrievedChunk,
  type ToneProfile,
} from "./types.js";

export {
  startFlow,
  stepFlow,
  validateFlow,
  dryRunFlow,
  FlowError,
  MAX_STEPS_PER_TURN,
  type BotFlow,
  type DryRunTurn,
  type FlowNode,
  type FlowState,
  type FlowStepResult,
  type FlowValidationIssue,
} from "./flow.js";

export {
  MessengerProfileService,
  buildProfilePayload,
  suggestIceBreakers,
  ProfileConfigError,
  MAX_ICE_BREAKERS,
  MAX_ICE_BREAKER_CHARS,
  type MenuAction,
  type PersistentMenuItem,
  type ProfilePayload,
} from "./messenger-profile.js";
