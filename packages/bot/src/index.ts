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
