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
import { recordMetric, RETELLING_METRIC } from "./metrics";
import { openUnlockQueue, type UnlockQueue, type UnlockQueueItem } from "./unlock-queue";

// 内容管道（issue #10）：链接/文本入口 → 正文抓取 → 难度管道 assess → 分流。
// 对外仅暴露 ingest(url) 与队列维护；L1/L2/L3 与 extractor/simplifier 均为实现细节。
// 易腐 + 太难的出路（issue #19，mvp.md 故事 9/10）：简化成功 → 简化版；
// 简化失败 → 角色转述任务（retell_tasks），不再纯搁置。

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
  kind: "direct" | "simplified" | "unlock_queued" | "retell";
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
  // 简化失败的易腐难文：转述任务已入队，待壳层注入角色会话（issue #19）。
  retell?: RetellTask;
};

// 角色转述任务（issue #19，mvp.md 故事 10）：简化失败的易腐难文交给好友角色，
// 由角色用大白话找用户聊文章讲了什么，用户当下即可参与讨论。
// 不泄题语义：转述不绑定任何埋伏目标语块、不要求用户产出——它不是考核，
// 因而不触发 ADR-0013 的话题生成硬规则；角色自然转述中用到在库语块属于
// 顺带复现，判分管道按常规暴露规则处理。
export type RetellTask = {
  contentId: string;
  title: string | null;
  sourceUrl: string;
  // 注入角色 system prompt 的转述提示（壳层只搬运，不解释）。
  prompt: string;
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
  // 待投递的转述任务（issue #19），按创建时间正序；壳层每轮对话取一条注入
  // 角色 prompt，注入后调用 markRetellDelivered。
  pendingRetells(): RetellTask[];
  // 标记转述任务已注入角色会话，并记 retelling-delivered 埋点。
  markRetellDelivered(contentId: string): void;
};

const LEVEL_ORDER: readonly Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function levelIndex(level: Cefr): number {
  return LEVEL_ORDER.indexOf(level);
}

function isHard(level: Cefr, threshold: Cefr): boolean {
  return levelIndex(level) >= levelIndex(threshold);
}

// 转述提示正文上限：避免超长文章把角色 prompt 撑爆（超出部分截断，
// 角色聊要点足够，用户可点原文链接读全文）。
const RETELL_BODY_LIMIT = 4000;

// 角色转述提示（issue #19）：让角色像朋友一样自然聊起这篇文章——
// 大白话讲清要点、邀请讨论；明确不考核、不上课、不预设目标表达。
export function buildRetellPrompt(input: {
  title: string | null;
  body: string;
  sourceUrl: string;
}): string {
  const body =
    input.body.length > RETELL_BODY_LIMIT
      ? `${input.body.slice(0, RETELL_BODY_LIMIT)}\n…（后文从略）`
      : input.body;
  return [
    `你刚读到一篇你可能会感兴趣的文章${input.title ? `：《${input.title}》` : ""}。`,
    "请像朋友分享新鲜事一样，用轻松的网聊语气主动跟用户聊这篇文章：",
    "- 用大白话讲清它讲了什么、为什么有意思（两三句即可）；",
    "- 自然邀请用户说说看法，让用户现在就能参与这个话题；",
    "- 不要上课、不要逐句翻译、不要考用户任何表达；",
    `- 若用户想读原文，给出链接：${input.sourceUrl}`,
    "",
    "文章原文（供你提炼要点）：",
    body,
  ].join("\n");
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

  const insertRetellTask = db.prepare(
    `INSERT INTO retell_tasks (id, user_id, language, content_id, prompt, status, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
  );
  const listPendingRetells = db.prepare(
    `SELECT content_id, prompt FROM retell_tasks
     WHERE user_id = ? AND language = ? AND status = 'pending'
     ORDER BY created_at`,
  );
  const getRetellContent = db.prepare(
    "SELECT id, title, source_url FROM content_items WHERE id = ? AND user_id = ?",
  );
  const markRetellTaskDelivered = db.prepare(
    "UPDATE retell_tasks SET status = 'delivered', delivered_at = ? WHERE content_id = ? AND user_id = ? AND status = 'pending'",
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
        // 简化失败：原文留档不丢（dismissed，不进解锁队列、不设过期）；
        // 同时生成角色转述任务（issue #19，mvp.md 故事 10）——由好友角色
        // 用大白话找用户聊文章要点，取代纯搁置。
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
        const prompt = buildRetellPrompt({
          title: input.title ?? null,
          body: input.body,
          sourceUrl: input.sourceUrl,
        });
        insertRetellTask.run(
          clock.newId(),
          userId,
          language,
          originalId,
          prompt,
          clock.now(),
        );
        return {
          ...baseResult,
          kind: "retell",
          retell: { contentId: originalId, title: input.title ?? null, sourceUrl: input.sourceUrl, prompt },
        };
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

    pendingRetells(): RetellTask[] {
      const rows = listPendingRetells.all(userId, language) as unknown as {
        content_id: string;
        prompt: string;
      }[];
      return rows.map((row) => {
        const content = getRetellContent.get(row.content_id, userId) as
          | { id: string; title: string | null; source_url: string }
          | undefined;
        return {
          contentId: row.content_id,
          title: content?.title ?? null,
          sourceUrl: content?.source_url ?? "",
          prompt: row.prompt,
        };
      });
    },

    markRetellDelivered(contentId: string): void {
      const now = clock.now();
      const result = markRetellTaskDelivered.run(now, contentId, userId);
      // changes 为 0 说明任务不存在或已投递：不重复计埋点。
      if (Number(result.changes) === 0) return;
      recordMetric({
        db,
        clock,
        language,
        name: RETELLING_METRIC,
        value: 1,
        payload: { contentId },
        userId,
      });
    },
  };
}

