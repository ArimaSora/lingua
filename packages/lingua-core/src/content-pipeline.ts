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
  kind: "direct" | "simplified" | "unlock_queued" | "dismissed";
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
  coverageThreshold?: number;
  maxA1SentenceLength?: number;
};

export type IngestProvidedInput = {
  title?: string | undefined;
  body: string;
  sourceUrl: string;
  publishedAt?: number | undefined;
  feedId?: string | undefined;
  audioUrl?: string | undefined;
};

export type ContentPipeline = {
  ingest(input: { url: string }): Promise<IngestResult>;
  ingestProvided(input: IngestProvidedInput): Promise<IngestResult>;
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
       status, pipeline_status, expires_at, simplified_source_id, audio_url, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    feedId?: string | null;
    audioUrl?: string | null;
  }): void {
    insertContent.run(
      params.id,
      userId,
      language,
      params.feedId ?? null,
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
      params.audioUrl ?? null,
      clock.now(),
    );
  }

  async function ingestProvided(input: IngestProvidedInput): Promise<IngestResult> {
    const difficultyInput: DifficultyInput = {
      text: input.body,
      url: input.sourceUrl,
      publishedAt: input.publishedAt,
    };
    const assessment = await difficulty.assess(difficultyInput);
    const { level, coverage, perishability } = assessment;

    const originalId = clock.newId();
    const baseResult: IngestResult = {
      kind: "direct",
      original: {
        id: originalId,
        title: input.title ?? null,
        body: input.body,
        sourceUrl: input.sourceUrl,
      },
      level,
      coverage,
      perishability,
    };

    if (!isHard(level, hardThreshold)) {
      createContentRow({
        id: originalId,
        sourceUrl: input.sourceUrl,
        title: input.title ?? null,
        body: input.body,
        difficultyScore: coverage,
        cefrEstimate: level,
        perishability,
        unlockLevel: null,
        pipelineStatus: "inbox",
        expiresAt: null,
        simplifiedSourceId: null,
        feedId: input.feedId ?? null,
        audioUrl: input.audioUrl ?? null,
      });
      return baseResult;
    }

    if (perishability === "perishable") {
      try {
        const simplified = await simplifier({
          title: input.title,
          body: input.body,
          url: input.sourceUrl,
          targetLevel: simplifyTargetLevel,
        });
        const simplifiedId = clock.newId();
        createContentRow({
          id: originalId,
          sourceUrl: input.sourceUrl,
          title: input.title ?? null,
          body: input.body,
          difficultyScore: coverage,
          cefrEstimate: level,
          perishability,
          unlockLevel: null,
          pipelineStatus: "dismissed",
          expiresAt: null,
          simplifiedSourceId: null,
          feedId: input.feedId ?? null,
          audioUrl: input.audioUrl ?? null,
        });
        createContentRow({
          id: simplifiedId,
          sourceUrl: input.sourceUrl,
          title: simplified.title,
          body: simplified.body,
          difficultyScore: 1,
          cefrEstimate: simplifyTargetLevel,
          perishability: "evergreen",
          unlockLevel: null,
          pipelineStatus: "simplified",
          expiresAt: null,
          simplifiedSourceId: originalId,
          feedId: input.feedId ?? null,
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
        // 简化失败：按 mvp.md 规则「易腐+太难 → 改写版，不进解锁队列」字面执行——
        // 搁置原文（留档不丢），不进队列、不设过期。unlock-queue 的过期机制
        // 保留给模块自身与未来入口，管道不再喂入易腐条目。
        createContentRow({
          id: originalId,
          sourceUrl: input.sourceUrl,
          title: input.title ?? null,
          body: input.body,
          difficultyScore: coverage,
          cefrEstimate: level,
          perishability,
          unlockLevel: null,
          pipelineStatus: "dismissed",
          expiresAt: null,
          simplifiedSourceId: null,
          feedId: input.feedId ?? null,
          audioUrl: input.audioUrl ?? null,
        });
        return { ...baseResult, kind: "dismissed" };
      }
    }

    createContentRow({
      id: originalId,
      sourceUrl: input.sourceUrl,
      title: input.title ?? null,
      body: input.body,
      difficultyScore: coverage,
      cefrEstimate: level,
      perishability,
      unlockLevel: level,
      pipelineStatus: "unlock_queued",
      expiresAt: null,
      simplifiedSourceId: null,
      feedId: input.feedId ?? null,
      audioUrl: input.audioUrl ?? null,
    });
    unlockQueue.add(originalId, { unlockLevel: level, expiresAt: null });

    return {
      ...baseResult,
      kind: "unlock_queued",
      unlockLabel: `原文难度约 ${level}`,
    };
  }

  async function ingest(input: { url: string }): Promise<IngestResult> {
    const extracted = await extractor(input.url);
    return ingestProvided({
      title: extracted.title,
      body: extracted.body,
      sourceUrl: input.url,
      publishedAt: extracted.publishedAt,
    });
  }

  return {
    ingest,
    ingestProvided,
    listUnlockQueue: () => unlockQueue.list(),
    expireUnlockQueue: (now?: number) => unlockQueue.expireOld(now),
  };
}

