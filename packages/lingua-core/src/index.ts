export {
  ADAPTIVE_ACCRUAL_FACTOR,
  ADAPTIVE_MAX_DAILY_ACCRUAL,
  ADAPTIVE_MIN_DAILY_ACCRUAL,
  ADAPTIVE_WINDOW_DAYS,
  BACKLOG_PAUSE_THRESHOLD,
  BACKLOG_RESUME_THRESHOLD,
  BALANCE_CAP,
  openAdmission,
  SEED_DAILY_ACCRUAL,
  SEED_EXIT_ACTIVE_DAYS,
  SEED_EXIT_COMPLETED_REVIEWS,
} from "./admission";
export type { Admission, AdmissionOptions, AdmissionPeriod, QuotaAccount } from "./admission";
export { restoreBackup, runBackup } from "./backup";
export type { BackupOptions, BackupResult, RestoreOptions } from "./backup";
export {
  openBootstrap,
  PRELEARNING_LIST_CLOSE,
  PRELEARNING_LIST_OPEN,
  renderLessonPush,
} from "./bootstrap";
export type {
  Bootstrap,
  BootstrapOptions,
  CompletedPreLearning,
  LessonStatus,
  PushedLesson,
  StoredLesson,
} from "./bootstrap";
export { CEFR_LEVELS, LESSON_KINDS, parseBootstrapPack } from "./bootstrap-pack";
export type {
  BootstrapPack,
  Cefr,
  LessonKind,
  PackChunk,
  PackLesson,
} from "./bootstrap-pack";
export {
  addRelationshipFact,
  characterCardFacts,
  getCharacterCard,
  loadCharacterCard,
  parseCharacterCard,
} from "./character-card";
export type {
  CharacterCard,
  LanguagePair,
} from "./character-card";
export { matchChunks } from "./chunk-matching";
export type {
  ChunkDescriptor,
  ChunkOccurrence,
  ChunkScan,
  ChunkScanStatus,
  MatchSummary,
} from "./chunk-matching";
export { openChunkStore } from "./chunk-store";
export type {
  Chunk,
  ChunkStatus,
  ChunkStore,
  ChunkStoreOptions,
  ChunkType,
  ContentScan,
  RegisterChunkInput,
  StoredOccurrence,
} from "./chunk-store";
export { FakeClock, SystemClock } from "./clock";
export type { Clock } from "./clock";
export { checkConfigPermissions, redactConfig, SECRET_MASK } from "./config-hardening";
export type { ConfigPermissionReport, ConfigPermissionStatus } from "./config-hardening";
export { openContentPipeline } from "./content-pipeline";
export type {
  ContentExtractor,
  ContentPipeline,
  ContentPipelineOptions,
  ContentSimplifier,
  IngestProvidedInput,
  IngestResult,
} from "./content-pipeline";
export { MIGRATION_VERSIONS, migrate, openDatabase, SCHEMA_VERSION } from "./database";
export type { Database } from "./database";
export { heuristicPerishability, openDifficultyPipeline } from "./difficulty";
export type {
  CoarseBand,
  CoarseGrader,
  DifficultyAssessment,
  DifficultyInput,
  DifficultyPipeline,
  DifficultyPipelineOptions,
  Perishability,
  PerishabilityTagger,
  Wordlist,
} from "./difficulty";
export { renderDigest } from "./digest";
export type { Digest, DigestOptions } from "./digest";
export { countTopicErrors, listTopicErrors, recordErrorLog } from "./error-log";
export type { ErrorLogEntry, RecordErrorLogInput } from "./error-log";
export { openExplanationLog } from "./explanation-log";
export type { ExplanationLog, ExplanationLogOptions, ExplanationRef } from "./explanation-log";
export { defaultParams, openEventStore } from "./event-store";
export type {
  Assistance,
  Evidence,
  EventStore,
  EventStoreOptions,
  EventType,
  FsrsRating,
  LearningEvent,
  LinguaParams,
  Outcome,
  PfaOutcome,
} from "./event-store";
export {
  EVIDENCE_LEVELS,
  KNOWLEDGE_CATEGORIES,
  loadKnowledgeEntries,
  openKnowledgeStore,
  parseKnowledgeEntries,
  renderExplanation,
} from "./knowledge-entry";
export type {
  EvidenceLevel,
  ExplanationLayer,
  KnowledgeCatalogItem,
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeStore,
} from "./knowledge-entry";
export { lemmatizeWord, tokenize } from "./lemmatizer";
export type { Token } from "./lemmatizer";
export { openMessageStore } from "./message-store";
export type {
  ChatContact,
  ChatMessage,
  ChatRole,
  MessageStore,
  MessageStoreOptions,
} from "./message-store";
export {
  AMBUSH_REPEAT_WINDOW_MS,
  MAX_AMBUSH_CHUNKS,
  MAX_BURIALS_IN_WINDOW,
  MAX_TOPICS_PER_DAY,
  openAmbush,
  STALE_TOPIC_MS,
} from "./ambush";
export type {
  Ambush,
  AmbushOptions,
  AmbushTopicPlan,
  ResolvedPlacement,
  ResolvedTopic,
} from "./ambush";
export { buildJudgePrompt, createJudge } from "./judge";
export type {
  Judge,
  JudgeOptions,
  JudgeRequest,
  JudgeTarget,
  JudgeVerdict,
  UsageJudge,
  UsageJudgeInput,
  UsageVerdict,
} from "./judge";
export { queryMetricsPanel } from "./metrics-panel";
export type {
  MasteryPoint,
  MetricsPanel,
  MetricsPanelInput,
  RetentionMetrics,
} from "./metrics-panel";
export { AMBUSH_HIT_METRIC, APP_OPEN_METRIC, recordMetric, TOPIC_RESPONSE_METRIC } from "./metrics";
export type { MetricInput, MetricName } from "./metrics";
export { DEFAULT_PFA_PARAMS, pfaMastery } from "./pfa";
export type { PfaParams } from "./pfa";
export type { ChunkMastery, Projection, ProjectionMode, SkillMastery } from "./projection";
export {
  acceptScaffoldingSuggestion,
  clearTemporaryScaffoldingTier,
  DEFAULT_SCAFFOLDING_TIER,
  effectiveRegisterRange,
  ensureLearnerProfile,
  formatScaffoldingSuggestion,
  getPendingSuggestion,
  getScaffoldingTier,
  parseScaffoldingTier,
  proposeScaffoldingTier,
  REGISTER_LABELS,
  REGISTER_LEVELS,
  registerCeiling,
  rejectScaffoldingSuggestion,
  SCAFFOLDING_TIER_LABELS,
  SCAFFOLDING_TIERS,
  scaffoldingPolicy,
  scaffoldingPolicyDescription,
  setScaffoldingTier,
  splitRegisterAnnotations,
} from "./scaffolding";
export type {
  L1Rescue,
  Register,
  RegisterAnnotation,
  RegisterRange,
  ScaffoldingPolicy,
  ScaffoldingSuggestion,
  ScaffoldingTier,
  ScaffoldingTierSource,
} from "./scaffolding";
export { openRssSubscriptions, parseRssFeed } from "./rss-subscriptions";
export type {
  FeedKind,
  RssEntry,
  RssFetcher,
  RssParser,
  RssPollReport,
  RssSubscriptions,
  RssSubscriptionsOptions,
  StoredFeed,
} from "./rss-subscriptions";
export { openScheduler } from "./scheduler";
export type { Scheduler, SchedulerOptions, SchedulerTask, TaskError, TickReport } from "./scheduler";
export {
  CORRECTION_CLOSE,
  CORRECTION_OPEN,
  ERROR_DIGEST_THRESHOLD,
  markTopicDigestSent,
  renderPendingSystemDigests,
  TOPIC_IDLE_MS,
} from "./system-digest";
export type { RenderSystemDigestsOptions, SystemDigest } from "./system-digest";
export { openUnlockQueue } from "./unlock-queue";
export type { UnlockQueue, UnlockQueueItem, UnlockQueueOptions } from "./unlock-queue";
