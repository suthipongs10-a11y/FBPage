export {
  normalizeText,
  normalizeAggressive,
  thaiDigitsToArabic,
  extractDigitRuns,
  containsAny,
} from "./normalize.js";

export {
  detectPhone,
  detectExternalLink,
  detectLineId,
  detectProfanity,
  detectBuyingIntent,
  detectComplaint,
  PROFANITY_TH,
  PROFANITY_EN,
  BUYING_INTENT_TH,
  COMPLAINT_TH,
  type DetectionHit,
  type DetectionKind,
} from "./detectors.js";

export {
  analyzeSentiment,
  shouldAlert,
  ALERT_CONFIDENCE_THRESHOLD,
  type Sentiment,
  type SentimentResult,
} from "./sentiment.js";

export {
  evaluateRules,
  defaultRules,
  renderTemplate,
  AUTO_HIDE_MIN_CONFIDENCE,
  AUTO_DELETE_MIN_CONFIDENCE,
  type RuleContext,
  type RuleEvaluation,
} from "./rules.js";

export { CommentActions, PRIVATE_REPLY_WINDOW_MS } from "./actions.js";

export {
  CommentProcessor,
  noopModerationAlerts,
  type CommentProcessorOptions,
  type CommentStore,
  type ModerationAlertSink,
  type ProcessResult,
} from "./processor.js";

export type {
  AutomationRule,
  IncomingComment,
  ModerationActionKind,
  ModerationDecision,
  PlannedAction,
  RuleTrigger,
  TemplateVars,
} from "./types.js";
