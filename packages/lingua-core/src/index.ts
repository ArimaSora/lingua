export { restoreBackup, runBackup } from "./backup";
export type { BackupOptions, BackupResult, RestoreOptions } from "./backup";
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
export { migrate, openDatabase, SCHEMA_VERSION } from "./database";
export type { Database } from "./database";
export { renderDigest } from "./digest";
export type { Digest, DigestOptions } from "./digest";
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
export { lemmatizeWord, tokenize } from "./lemmatizer";
export type { Token } from "./lemmatizer";
export { DEFAULT_PFA_PARAMS, pfaMastery } from "./pfa";
export type { PfaParams } from "./pfa";
export type { ChunkMastery, Projection, ProjectionMode, SkillMastery } from "./projection";
