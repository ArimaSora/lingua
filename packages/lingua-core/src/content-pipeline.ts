import type { Clock } from "./clock";
import type { Database } from "./database";
import type { Cefr } from "./bootstrap-pack";
import {
  heuristicPerishability,
  openDifficultyPipeline,
  type CoarseGrader,
  type DifficultyInput,
  type PerishabilityTagger,
  type Wordlist,
} from "./difficulty";
import { openUnlockQueue, type UnlockQueue, type UnlockQueueItem } from "./unlock-queue";

// 内容管道（issue #10）：链接/文本入口 → 正文抓取 → 难度管道 assess → 分流。
// 对外仅暴露 ingest(url) 与队列维护；L1/L2/L3 与 extractor/simplifier 均为实现细节。

export type ContentExtractor = (
  url: string,
) => Promise<{ title?: string | undefined; body: string; publishedAt?: number | undefined }>;

export type ContentSimplifier = (input: {
  title?: string | undefined;
  body: string;
  url: string;
  targetLevel: Cefr;
}) => Promise<{ title: string; body: string }>;

export type IngestResult = {
  kind: "direct" | "simplified" | "unlock_queued";
  original: {
    id: string;
    title: string | null;
    body: string;
    sourceUrl: string;
  };
  level: Cefr;
  coverage: number;
  perishability: "perishable" | "evergreen";
  simplified?: { id: string; title: string; body: string };
  unlockLabel?: string;
};

export type ContentPipelineOptions = {
  db: Database;
  clock: Clock;
  language: string;
  extractor: ContentExtractor;
  simplifier: ContentSimplifier;
  wordlist: Wordlist;
  grader?: CoarseGrader | null | undefined;
  tagger?: PerishabilityTagger | null | undefined;
  userId?: string;
  // 何为「太难」：超过此级别的内容走分流；默认 B1 以上（A1 用户现实）。
  hardThreshold?: Cefr;
  // 简化目标级；默认 A2。
  simplifyTargetLevel?: Cefr;
  // 易腐内容入解锁队列后的 TTL（毫秒）；默认 7 天。
  perishableQueueTtlMs?: number;
  coverageThreshold?: number;
  maxA1SentenceLength?: number;
};

export type ContentPipeline = {
  ingest(input: { url: string }): Promise<IngestResult>;
  listUnlockQueue(): UnlockQueueItem[];
  expireUnlockQueue(now?: number): string[];
};

const LEVEL_ORDER: readonly Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function levelIndex(level: Cefr): number {
  return LEVEL_ORDER.indexOf(level);
}

function isHard(level: Cefr, threshold: Cefr): boolean {
  return levelIndex(level) >= levelIndex(threshold);
}

export function openContentPipeline(options: ContentPipelineOptions): ContentPipeline {
  const {
    db,
    clock,
    language,
    extractor,
    simplifier,
    wordlist,
    grader = null,
    tagger = null,
  } = options;
  const userId = options.userId ?? "local";
  const hardThreshold = options.hardThreshold ?? "B1";
  const simplifyTargetLevel = options.simplifyTargetLevel ?? "A2";
  const perishableQueueTtlMs = options.perishableQueueTtlMs ?? 7 * 24 * 60 * 60 * 1000;

  const difficulty = openDifficultyPipeline({
    wordlist,
    grader,
    tagger,
    coverageThreshold: options.coverageThreshold,
    maxA1SentenceLength: options.maxA1SentenceLength,
  });

  const unlockQueue: UnlockQueue = openUnlockQueue({ db, clock, userId, language });

  const insertContent = db.prepare(
    `INSERT INTO content_items (
       id, user_id, language, feed_id, source_url, title, body,
       difficulty_score, cefr_estimate, perishability, unlock_level,
       status, pipeline_status, expires_at, simplified_source_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function createContentRow(params: {
    id: string;
    sourceUrl: string;
    title: string | null;
    body: string;
    difficultyScore: number;
    cefrEstimate: Cefr;
    perishability: "perishable" | "evergreen";
    unlockLevel: Cefr | null;
    pipelineStatus: "inbox" | "unlock_queued" | "simplified" | "dismissed";
    expiresAt: number | null;
    simplifiedSourceId: string | null;
  }): void {
    insertContent.run(
      params.id,
      userId,
      language,
      null,
      params.sourceUrl,
      params.title,
      params.body,
      params.difficultyScore,
      params.cefrEstimate,
      params.perishability,
      params.unlockLevel,
      "inbox", // 保留原 status 列兼容值
      params.pipelineStatus,
      params.expiresAt,
      params.simplifiedSourceId,
      clock.now(),
    );
  }

  async function ingest(input: { url: string }): Promise<IngestResult> {
    const extracted = await extractor(input.url);
    const difficultyInput: DifficultyInput = {
      text: extracted.body,
      url: input.url,
      publishedAt: extracted.publishedAt,
    };
    const assessment = await difficulty.assess(difficultyInput);
    const { level, coverage, perishability } = assessment;

    const originalId = clock.newId();
    const baseResult: IngestResult = {
      kind: "direct",
      original: {
        id: originalId,
        title: extracted.title ?? null,
        body: extracted.body,
        sourceUrl: input.url,
      },
      level,
      coverage,
      perishability,
    };

    if (!isHard(level, hardThreshold)) {
      createContentRow({
        id: originalId,
        sourceUrl: input.url,
        title: extracted.title ?? null,
        body: extracted.body,
        difficultyScore: coverage,
        cefrEstimate: level,
        perishability,
        unlockLevel: null,
        pipelineStatus: "inbox",
        expiresAt: null,
        simplifiedSourceId: null,
      });
      return baseResult;
    }

    if (perishability === "perishable") {
      try {
        const simplified = await simplifier({
          title: extracted.title,
          body: extracted.body,
          url: input.url,
          targetLevel: simplifyTargetLevel,
        });
        const simplifiedId = clock.newId();
        createContentRow({
          id: originalId,
          sourceUrl: input.url,
          title: extracted.title ?? null,
          body: extracted.body,
          difficultyScore: coverage,
          cefrEstimate: level,
          perishability,
          unlockLevel: null,
          pipelineStatus: "dismissed",
          expiresAt: null,
          simplifiedSourceId: null,
        });
        createContentRow({
          id: simplifiedId,
          sourceUrl: input.url,
          title: simplified.title,
          body: simplified.body,
          difficultyScore: 1,
          cefrEstimate: simplifyTargetLevel,
          perishability: "evergreen",
          unlockLevel: null,
          pipelineStatus: "simplified",
          expiresAt: null,
          simplifiedSourceId: originalId,
        });
        return {
          ...baseResult,
          kind: "simplified",
          simplified: {
            id: simplifiedId,
            title: simplified.title,
            body: simplified.body,
          },
        };
      } catch {
        // 简化失败：避免信息丢失，降级为常青解锁队列处理（带过期）。
      }
    }

    const expiresAt = perishability === "perishable" ? clock.now() + perishableQueueTtlMs : null;
    createContentRow({
      id: originalId,
      sourceUrl: input.url,
      title: extracted.title ?? null,
      body: extracted.body,
      difficultyScore: coverage,
      cefrEstimate: level,
      perishability,
      unlockLevel: level,
      pipelineStatus: "unlock_queued",
      expiresAt,
      simplifiedSourceId: null,
    });
    unlockQueue.add(originalId, { unlockLevel: level, expiresAt });

    return {
      ...baseResult,
      kind: "unlock_queued",
      unlockLabel: `原文难度约 ${level}`,
    };
  }

  return {
    ingest,
    listUnlockQueue: () => unlockQueue.list(),
    expireUnlockQueue: (now?: number) => unlockQueue.expireOld(now),
  };
}

