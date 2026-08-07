export {
  METRICS,
  DEPRECATED_METRICS,
  METRIC_REPLACEMENTS,
  DeprecatedMetricError,
  assertNotDeprecated,
  isDeprecatedMetric,
  metricDef,
  metaMetricNames,
  keyForMetaName,
  formatMetric,
  type MetricDef,
  type MetricGroup,
} from "./metrics.js";

export {
  InsightsSync,
  MAX_BACKFILL_DAYS,
  dateKeyInZone,
  shiftDate,
  daysBetween,
  type DailyMetric,
  type InsightsRepository,
  type InsightsSyncOptions,
  type InternalStatsSource,
  type SyncResult,
} from "./sync.js";

export {
  buildMonthlyReport,
  compareMetric,
  monthLabelTh,
  monthRange,
  previousMonth,
  type BuildReportArgs,
  type InboxSummary,
  type MetricComparison,
  type MonthlyReport,
  type TopPost,
} from "./report.js";

export {
  renderReportHtml,
  escapeHtml,
  type BrandConfig,
} from "./render.js";

export {
  computeContainment,
  findUnansweredQuestions,
  type ContainmentStats,
  type ConversationOutcome,
  type UnansweredQuestion,
} from "./bot-performance.js";
