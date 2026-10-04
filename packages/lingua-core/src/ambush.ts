import { matchChunks } from "./chunk-matching";
import type { ChunkDescriptor } from "./chunk-matching";
import type { Clock } from "./clock";
import type { Database } from "./database";
import { DAY_MS, dayStart } from "./day";
import type { EventStore } from "./event-store";
import { recordErrorLog } from "./error-log";
import type { Judge, JudgeRequest, JudgeVerdict } from "./judge";
import { projectState } from "./projection";
import { recordMetric, AMBUSH_HIT_METRIC, TOPIC_RESPONSE_METRIC } from "./metrics";

// 埋伏式复习调度（issue #7/#8，mvp.md 双联系人与主动性）：
// - 候选池 = 到期语块 + 订阅新内容（v1 先实现到期语块），事件驱动有料才起；
// - 每话题埋 2–4 个到期语块，同语块 48h 内最多埋 2 次，未命中回炉重排；
// - 判分闭环同时写入错误日志（issue #8），供系统小结消费；
// - 不泄题硬规则（ADR-0013）：话题生成提示不得包含目标语块形式或直译。

export const STALE_TOPIC_MS = 24 * 60 * 60 * 1000;
export const AMBUSH_REPEAT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const MAX_AMBUSH_CHUNKS = 4;
export const MAX_BURIALS_IN_WINDOW = 2;
export const MAX_TOPICS_PER_DAY = 3;

// 「用户先求助」检测口径（issue #18；ADR-0013 辅助判定第三支）：
// v1 用确定性显式标记词，不用 LLM 分类。判定规则：用户消息中出现任一求助
// 标记，且标记起点早于该语块命中的起始字符（「先」求助后产出），该语块判对
// 时计辅助（assisted）。LLM 分类口径留待验证协议的人工标注样本（docs/
// validation.md）证明需要时再引入。
export const HELP_REQUEST_RES: readonly RegExp[] = [
  /怎么说/,
  /怎么用/,
  /什么意思/,
  /求助/,
  /帮帮我|救救我|教教我|我不会说|我不会用/,
  /how (do|can|would) (you )?say\b/i,
  /how (do|can|would) (you )?use\b/i,
  /how to (say|use)\b/i,
  /what (does|do|did) [\w'’ ]{1,30} mean\b/i,
  /i (really )?(need|want) help\b/i,
  /help me\b/i,
  /i don'?t (even )?know how\b/i,
];

// 最早的求助标记起点；无标记返回 -1。
export function firstHelpRequestIndex(text: string): number {
  let min = -1;
  for (const re of HELP_REQUEST_RES) {
    const match = re.exec(text);
    if (match && (min === -1 || match.index < min)) min = match.index;
  }
  return min;
}

export type AmbushTopicPlan = {
  topicId: string;
  language: string;
  topicText: string;
  prompt: string;
  chunkIds: string[];
  scenarios: string[];
};

export type ResolvedPlacement = {
  placementId: string;
  chunkId: string;
  outcome: "hit" | "missed";
  verdict: JudgeVerdict;
};

// 壳层运行时接线用的开放话题视图（issue #07）：只含注入 prompt 与判分所需
// 的标识，不含场景细节（场景只在规划时用）。
export type OpenTopic = {
  topicId: string;
  topicText: string;
  prompt: string;
  chunkIds: string[];
};

export type ResolvedTopic = {
  topicId: string;
  status: "resolved" | "stale";
  placements: ResolvedPlacement[];
};

export type AmbushOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
};

export type Ambush = {
  planAmbushTopic(language: string): AmbushTopicPlan | null;
  // 取当前开放话题（无则尝试规划；配额用尽或无候选时返回 null）。
  // 壳层每轮对话调用一次，把 prompt 注入角色 system prompt。
  openTopic(language: string): OpenTopic | null;
  resolveTopic(input: {
    topicId: string;
    userText: string;
    judge: Judge;
    store: EventStore;
    exposedRecently?: boolean;
    // 近期角色消息原文（确定性暴露规则的输入，ADR-0013）：任一目标语块形式
    // 出现在这些文本中即视为该语块近期被示范（辅助），按语块分别判定。
    recentCompanionTexts?: string[];
  }): Promise<ResolvedTopic>;
};

type ChunkRow = {
  id: string;
  canonical_form: string;
  variants: string;
};

type LessonRow = {
  id: string;
  title: string;
  hook: string;
};

type TopicRow = {
  id: string;
  language: string;
  status: string;
  opened_at: number;
  topic_text: string;
};

type PlacementRow = {
  id: string;
  topic_id: string;
  chunk_id: string;
  buried_at: number;
  resolved_at: number | null;
  outcome: "hit" | "missed" | null;
};

function parseVariants(variants: string): string[] {
  try {
    return JSON.parse(variants) as string[];
  } catch {
    return [];
  }
}

function formsOf(chunk: ChunkRow): string[] {
  return [chunk.canonical_form, ...parseVariants(chunk.variants)];
}

function containsAny(text: string, forms: string[]): boolean {
  const lower = text.toLowerCase();
  return forms.some((form) => lower.includes(form.toLowerCase()));
}

export function openAmbush(options: AmbushOptions): Ambush {
  const { db, clock } = options;
  const userId = options.userId ?? "local";

  const getChunk = db.prepare(
    "SELECT id, canonical_form, variants FROM chunks WHERE id = ? AND user_id = ?",
  );
  const getChunkDescriptor = db.prepare(
    "SELECT id, canonical_form, chunk_type, variants, slot_pattern FROM chunks WHERE id = ? AND user_id = ?",
  );
  const getLesson = db.prepare(
    "SELECT id, title, hook FROM bootstrap_lessons WHERE id = ? AND user_id = ?",
  );
  const listOpenTopics = db.prepare(
    "SELECT id, language, status, opened_at FROM ambush_topics WHERE user_id = ? AND language = ? AND status = 'open' ORDER BY opened_at",
  );
  const listSameDayTopics = db.prepare(
    "SELECT id, opened_at FROM ambush_topics WHERE user_id = ? AND language = ? AND opened_at >= ? AND opened_at < ?",
  );
  const countBurialsInWindow = db.prepare(
    "SELECT COUNT(*) AS n FROM ambush_placements WHERE user_id = ? AND chunk_id = ? AND buried_at > ? AND buried_at <= ?",
  );
  const insertTopic = db.prepare(
    `INSERT INTO ambush_topics (id, user_id, language, status, topic_text, prompt, opened_at, closed_at)
     VALUES (?, ?, ?, 'open', ?, ?, ?, NULL)`,
  );
  const insertPlacement = db.prepare(
    `INSERT INTO ambush_placements (id, user_id, language, topic_id, chunk_id, buried_at, resolved_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
  );
  const getLatestOpenTopic = db.prepare(
    "SELECT id, topic_text, prompt FROM ambush_topics WHERE user_id = ? AND language = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
  );

  const getTopic = db.prepare(
    "SELECT id, language, status, opened_at, topic_text FROM ambush_topics WHERE id = ? AND user_id = ?",
  );
  const listTopicPlacements = db.prepare(
    "SELECT id, topic_id, chunk_id, buried_at, resolved_at, outcome FROM ambush_placements WHERE topic_id = ? AND user_id = ?",
  );
  const updatePlacement = db.prepare(
    "UPDATE ambush_placements SET resolved_at = ?, outcome = ? WHERE id = ?",
  );
  const closeTopic = db.prepare(
    "UPDATE ambush_topics SET status = ?, closed_at = ? WHERE id = ?",
  );

  function closeStaleTopics(language: string, now: number): void {
    const openTopics = listOpenTopics.all(userId, language) as unknown as TopicRow[];
    for (const topic of openTopics) {
      if (topic.opened_at + STALE_TOPIC_MS > now) continue;

      const placements = listTopicPlacements.all(topic.id, userId) as unknown as PlacementRow[];
      for (const placement of placements) {
        if (placement.outcome !== null) continue;
        updatePlacement.run(now, "missed", placement.id);
        recordMetric({
          db,
          clock,
          language,
          name: AMBUSH_HIT_METRIC,
          value: 0,
          payload: { topicId: topic.id, chunkId: placement.chunk_id, reason: "stale" },
          userId,
        });
      }
      closeTopic.run("stale", now, topic.id);
      recordMetric({
        db,
        clock,
        language,
        name: TOPIC_RESPONSE_METRIC,
        value: 0,
        payload: { topicId: topic.id, reason: "stale" },
        userId,
      });
    }
  }

  function hasFreshOpenTopic(language: string, now: number): boolean {
    const openTopics = listOpenTopics.all(userId, language) as unknown as TopicRow[];
    return openTopics.some((topic) => topic.opened_at + STALE_TOPIC_MS > now);
  }

  function sameDayTopicCount(language: string, now: number): number {
    const start = dayStart(now);
    const end = start + DAY_MS;
    const row = listSameDayTopics.get(userId, language, start, end) as { n: number } | undefined;
    // sqlite COUNT(*) returns bigint via DatabaseSync; coerce.
    return row ? Number(row.n) : 0;
  }

  function buriedCountInWindow(chunkId: string, now: number): number {
    const windowStart = now - AMBUSH_REPEAT_WINDOW_MS;
    const row = countBurialsInWindow.get(userId, chunkId, windowStart, now) as
      | { n: number }
      | undefined;
    return row ? Number(row.n) : 0;
  }

  function eligibleDueChunks(language: string, now: number): string[] {
    const projection = projectState(db, "current-belief", now, language);
    const due = projection.chunks
      .filter((chunk) => chunk.dueAt !== null && chunk.dueAt <= now)
      .sort((a, b) =>
        a.dueAt! - b.dueAt! !== 0 ? a.dueAt! - b.dueAt! : a.chunkId < b.chunkId ? -1 : 1,
      );

    return due
      .filter((chunk) => buriedCountInWindow(chunk.chunkId, now) < MAX_BURIALS_IN_WINDOW)
      .map((chunk) => chunk.chunkId);
  }

  function scenarioForChunk(chunk: ChunkRow, sourceContentId: string | null): string {
    if (!sourceContentId) {
      return `一个需要你使用日常表达的自然场景。`;
    }
    const lesson = getLesson.get(sourceContentId, userId) as LessonRow | undefined;
    const hint = lesson ? `${lesson.title}（${lesson.hook}）` : `一个日常场景。`;
    if (containsAny(hint, formsOf(chunk))) {
      throw new Error(`泄题风险：场景线索包含语块形式 ${chunk.canonical_form}`);
    }
    return hint;
  }

  function buildPrompt(language: string, scenarios: string[], chunkForms: string[]): string {
    const joinedScenarios = scenarios.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const prompt = [
      `你是学习者的英语好友。请用一段自然、轻松的网聊开场白，发起一个与以下场景相关的话题。目标是让学习者在回复中自然用到他最近学过的表达。`,
      "",
      "可用场景（只选其一，自然切入）：",
      joinedScenarios,
      "",
      "约束：",
      "- 不要直接说出或翻译目标表达；让学习者自己提取。",
      "- 语气像朋友，短句、口语化。",
      "- 只输出角色要说的英文消息，不要解释。",
    ].join("\n");

    if (containsAny(prompt, chunkForms)) {
      throw new Error("泄题风险：生成提示包含目标语块形式或直译");
    }
    return prompt;
  }

  function planAmbushTopic(language: string): AmbushTopicPlan | null {
    const now = clock.now();
    closeStaleTopics(language, now);

    if (hasFreshOpenTopic(language, now)) return null;
    if (sameDayTopicCount(language, now) >= MAX_TOPICS_PER_DAY) return null;

    const eligible = eligibleDueChunks(language, now);
    if (eligible.length < 2) return null;

    const selectedIds = eligible.slice(0, MAX_AMBUSH_CHUNKS);
    const chunks: ChunkRow[] = [];
    for (const id of selectedIds) {
      const row = getChunk.get(id, userId) as ChunkRow | undefined;
      if (!row) throw new Error(`unknown chunk: ${id}`);
      chunks.push(row);
    }

    const sourceIds = new Map(
      (
        db
          .prepare(
            "SELECT id, source_content_id FROM chunks WHERE id IN (" +
              selectedIds.map(() => "?").join(",") +
              ")",
          )
          .all(...selectedIds) as unknown as { id: string; source_content_id: string | null }[]
      ).map((row) => [row.id, row.source_content_id]),
    );

    const scenarios: string[] = [];
    const allForms: string[] = [];
    for (const chunk of chunks) {
      const sourceContentId = sourceIds.get(chunk.id) ?? null;
      scenarios.push(scenarioForChunk(chunk, sourceContentId));
      allForms.push(...formsOf(chunk));
    }

    const prompt = buildPrompt(language, scenarios, allForms);
    const topicText = `Let's talk about ${scenarios[0]}`;

    const topicId = clock.newId();
    insertTopic.run(topicId, userId, language, topicText, prompt, now);
    for (const chunk of chunks) {
      insertPlacement.run(clock.newId(), userId, language, topicId, chunk.id, now);
    }

    return {
      topicId,
      language,
      topicText,
      prompt,
      chunkIds: selectedIds,
      scenarios,
    };
  }

  function wasExposed(chunkId: string, recentCompanionTexts: string[]): boolean {
    if (recentCompanionTexts.length === 0) return false;
    const chunk = getChunk.get(chunkId, userId) as ChunkRow | undefined;
    if (!chunk) return false;
    return recentCompanionTexts.some((text) => containsAny(text, formsOf(chunk)));
  }

  function openTopic(language: string): OpenTopic | null {
    const now = clock.now();
    closeStaleTopics(language, now);
    const row = getLatestOpenTopic.get(userId, language) as
      | { id: string; topic_text: string; prompt: string }
      | undefined;
    if (row) {
      const placements = listTopicPlacements.all(row.id, userId) as unknown as PlacementRow[];
      return {
        topicId: row.id,
        topicText: row.topic_text,
        prompt: row.prompt,
        chunkIds: placements.map((placement) => placement.chunk_id),
      };
    }
    const plan = planAmbushTopic(language);
    if (!plan) return null;
    return {
      topicId: plan.topicId,
      topicText: plan.topicText,
      prompt: plan.prompt,
      chunkIds: plan.chunkIds,
    };
  }

  async function resolveTopic(input: {
    topicId: string;
    userText: string;
    judge: Judge;
    store: EventStore;
    exposedRecently?: boolean;
    // 近期角色消息原文（确定性暴露规则的输入，ADR-0013）：任一目标语块形式
    // 出现在这些文本中即视为该语块近期被示范（辅助），按语块分别判定。
    recentCompanionTexts?: string[];
  }): Promise<ResolvedTopic> {
    const { topicId, userText, judge, store, exposedRecently = false, recentCompanionTexts } = input;
    const now = clock.now();
    const topic = getTopic.get(topicId, userId) as TopicRow | undefined;
    if (!topic) throw new Error(`unknown topic: ${topicId}`);
    if (topic.status !== "open") throw new Error(`topic is not open: ${topicId}`);

    const placements = listTopicPlacements.all(topicId, userId) as unknown as PlacementRow[];
    // 「用户先求助」（issue #18，ADR-0013 第三支）：求助标记起点早于该语块
    // 命中起点才算「先」；命中位置复用判分管道的确定性匹配（词形还原 +
    // token 区间），与 Judge 命中口径一致。
    const helpIndex = firstHelpRequestIndex(userText);
    const descriptors: ChunkDescriptor[] = placements.map((placement) => {
      const row = getChunkDescriptor.get(placement.chunk_id, userId) as
        | {
            id: string;
            canonical_form: string;
            chunk_type: string;
            variants: string;
            slot_pattern: string | null;
          }
        | undefined;
      if (!row) throw new Error(`unknown chunk: ${placement.chunk_id}`);
      return {
        id: row.id,
        canonicalForm: row.canonical_form,
        chunkType: row.chunk_type,
        variants: parseVariants(row.variants),
        slotPattern: row.slot_pattern,
      };
    });
    const { occurrences } = matchChunks(userText, descriptors);
    const occurrenceStart = new Map(occurrences.map((o) => [o.chunkId, o.startChar]));

    const targets = placements.map((placement) => {
      const start = occurrenceStart.get(placement.chunk_id) ?? -1;
      const askedFirst = helpIndex !== -1 && start !== -1 && helpIndex < start;
      return {
        chunkId: placement.chunk_id,
        // 暴露 = 调用方标记 OR 近几轮角色/系统消息中出现过该语块任一形式
        //（ADR-0013，确定性规则在核心内判定，按语块分别计）OR 用户先求助
        //（issue #18：本回合求助标记先于语块命中）。
        exposedRecently:
          exposedRecently ||
          wasExposed(placement.chunk_id, recentCompanionTexts ?? []) ||
          askedFirst,
      };
    });

    const request: JudgeRequest = {
      userText,
      targets,
      topicText: topic.topic_text,
    };
    const verdicts = targets.length > 0 ? await judge.judge(request) : [];

    const observationId = clock.newId();
    const resolved: ResolvedPlacement[] = [];
    for (const placement of placements) {
      const verdict = verdicts.find((v) => v.chunkId === placement.chunk_id);
      if (!verdict) {
        throw new Error(`missing verdict for chunk ${placement.chunk_id}`);
      }
      const target = targets.find((t) => t.chunkId === placement.chunk_id)!;
      const outcome: "hit" | "missed" =
        verdict.outcome === "correct" && !target.exposedRecently ? "hit" : "missed";
      updatePlacement.run(now, outcome, placement.id);

      if (verdict.outcome === "not-produced") {
        store.recordEvidence({
          observationId,
          chunkId: placement.chunk_id,
          outcome: "not-produced",
          confidence: verdict.confidence,
          quote: verdict.quote,
          topicId,
          judge: { name: judge.name, version: judge.version },
        });
      } else {
        store.recordEvidence({
          observationId,
          chunkId: placement.chunk_id,
          outcome: verdict.outcome,
          assistance: target.exposedRecently ? "assisted" : "none",
          confidence: verdict.confidence,
          quote: verdict.quote,
          topicId,
          judge: { name: judge.name, version: judge.version },
        });
      }

      // 语法/用法错误写入独立错误日志，与学习者状态解耦（issue #8）。
      if (verdict.outcome === "wrong") {
        const chunk = getChunk.get(placement.chunk_id, userId) as ChunkRow | undefined;
        const canonicalForm = chunk?.canonical_form ?? placement.chunk_id;
        recordErrorLog({
          db,
          clock,
          userId,
          language: topic.language,
          topicId,
          chunkId: placement.chunk_id,
          originalText: userText,
          quote: verdict.quote,
          errorType: "usage",
          phenomenon: `你用了 "${verdict.quote}"，这个表达里有个地方不太对，能发现吗？`,
          correction: `参考答案：${canonicalForm}。`,
        });
      }

      recordMetric({
        db,
        clock,
        language: topic.language,
        name: AMBUSH_HIT_METRIC,
        value: outcome === "hit" ? 1 : 0,
        payload: { topicId, chunkId: placement.chunk_id, verdict: verdict.outcome },
        userId,
      });
      resolved.push({ placementId: placement.id, chunkId: placement.chunk_id, outcome, verdict });
    }

    const status: "resolved" = "resolved";
    closeTopic.run(status, now, topicId);
    recordMetric({
      db,
      clock,
      language: topic.language,
      name: TOPIC_RESPONSE_METRIC,
      value: 1,
      payload: { topicId },
      userId,
    });

    return { topicId, status, placements: resolved };
  }

  return { planAmbushTopic, openTopic, resolveTopic };
}
