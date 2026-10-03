import type { BootstrapPack, PackChunk, PackLesson } from "./bootstrap-pack";
import { openChunkStore } from "./chunk-store";
import type { Clock } from "./clock";
import type { Database } from "./database";
import { openEventStore } from "./event-store";
import type { LearningEvent } from "./event-store";
import { openMessageStore } from "./message-store";
import type { ChatMessage } from "./message-store";

// Bootstrap 运行时（issue #6）：课包的播种、按序推送与预学完成闭环。
// 课 = 内容源（GLOSSARY）：播种时每课落一行 bootstrap_lessons（状态机
// pending → pushed → prelearned）+ 同 id 的 content_items 条目，
// 语块 source_content_id 指向它——课包内容与订阅内容走同一套闭环（故事 12）。

export type LessonStatus = "pending" | "pushed" | "prelearned";

export type StoredLesson = PackLesson & {
  userId: string;
  language: string;
  packId: string;
  seq: number;
  chunkIds: string[] | null;
  messageId: string | null;
  status: LessonStatus;
  pushedAt: number | null;
  prelearnedAt: number | null;
};

export type Bootstrap = {
  // 播种课包：课与内容条目落库为待推送；幂等（已存在的课不动）。
  seedPack(pack: BootstrapPack): { inserted: number };
  // 按推送序列出该语言全部课（含状态）。
  lessons(language: string): StoredLesson[];
  // 推送下一课到系统会话：上一课未完成预学时不推新课（按序，不堆债）；
  // 无课可推返回 null。推送即把课内语块注册为正式语块并入调度。
  pushNextLesson(language: string): PushedLesson | null;
  // 当前已推送、待预学完成的课（每语言至多一课）。
  pendingLesson(language: string): StoredLesson | null;
  // 预学完成：为课内每个语块记 initial-learning（ADR-0016——初次学习单独
  // 记录，不冒充成功回忆、不更新掌握度；首次到期 = 预学次日）。
  // 无待完成课返回 null；幂等（完成的课不会再次记录）。
  completePreLearning(language: string): CompletedPreLearning | null;
};

export type PushedLesson = {
  lesson: StoredLesson;
  chunkIds: string[];
  message: ChatMessage;
};

export type CompletedPreLearning = {
  lesson: StoredLesson;
  events: LearningEvent[];
};

export type BootstrapOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
};

type LessonRow = {
  id: string;
  user_id: string;
  language: string;
  pack_id: string;
  seq: number;
  title: string;
  kind: StoredLesson["kind"];
  hook: string;
  body: string;
  chunks: string;
  chunk_ids: string | null;
  message_id: string | null;
  status: LessonStatus;
  pushed_at: number | null;
  prelearned_at: number | null;
};

function rowToLesson(row: LessonRow): StoredLesson {
  return {
    id: row.id,
    userId: row.user_id,
    language: row.language,
    packId: row.pack_id,
    seq: row.seq,
    title: row.title,
    kind: row.kind,
    hook: row.hook,
    body: row.body,
    chunks: JSON.parse(row.chunks) as PackChunk[],
    chunkIds: row.chunk_ids === null ? null : (JSON.parse(row.chunk_ids) as string[]),
    messageId: row.message_id,
    status: row.status,
    pushedAt: row.pushed_at,
    prelearnedAt: row.prelearned_at,
  };
}

// 预学清单的可展开标记：推送消息为纯文本，壳层 UI 据此把清单渲染为
// 可展开折叠（默认只给第一层解释，ADR-0005）。标记内首行 = 折叠摘要。
export const PRELEARNING_LIST_OPEN = "[[预学清单]]";
export const PRELEARNING_LIST_CLOSE = "[[/预学清单]]";

const CHUNK_TYPE_LABEL: Record<PackChunk["chunkType"], string> = {
  collocation: "搭配",
  idiom: "惯用语",
};

// 系统推送文案：纯工具文案无人格（ADR-0008）——课标题、一句兴趣钩子、
// 可展开预学清单（例句 + 一句直觉规律）、课正文、预学完成指引。
export function renderLessonPush(lesson: StoredLesson, packTotal: number): string {
  const list = lesson.chunks
    .map(
      (chunk, index) =>
        `${index + 1}. ${chunk.form}（${CHUNK_TYPE_LABEL[chunk.chunkType]} · ${chunk.cefr}）\n` +
        `   例句：${chunk.example}\n` +
        `   直觉规律：${chunk.intuition}`,
    )
    .join("\n");
  return [
    `【Bootstrap 课包 · 第 ${lesson.seq}/${packTotal} 课】${lesson.title}`,
    `为什么你会感兴趣：${lesson.hook}`,
    "",
    PRELEARNING_LIST_OPEN,
    `预学清单（${lesson.chunks.length} 个语块，点开预学）`,
    list,
    PRELEARNING_LIST_CLOSE,
    "",
    "正文：",
    lesson.body,
    "",
    "预学完成后回复「完成」：这些表达会被记入调度，明天起到期复习。",
  ].join("\n");
}

export function openBootstrap(options: BootstrapOptions): Bootstrap {
  const { db, clock } = options;
  const userId = options.userId ?? "local";
  const chunks = openChunkStore({ db, clock, userId });
  const messages = openMessageStore({ db, clock });

  const insertLesson = db.prepare(
    `INSERT OR IGNORE INTO bootstrap_lessons (
       id, user_id, language, pack_id, seq, title, kind, hook, body, chunks, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertContent = db.prepare(
    `INSERT OR IGNORE INTO content_items (
       id, user_id, language, title, body, perishability, created_at
     ) VALUES (?, ?, ?, ?, ?, 'evergreen', ?)`,
  );
  const listLessons = db.prepare(
    `SELECT * FROM bootstrap_lessons
     WHERE user_id = ? AND language = ? ORDER BY pack_id, seq`,
  );

  function seedPack(pack: BootstrapPack): { inserted: number } {
    let inserted = 0;
    pack.lessons.forEach((lesson, index) => {
      const result = insertLesson.run(
        lesson.id,
        userId,
        pack.language,
        pack.id,
        index + 1,
        lesson.title,
        lesson.kind,
        lesson.hook,
        lesson.body,
        JSON.stringify(lesson.chunks),
        clock.now(),
      );
      if (result.changes > 0) inserted += 1;
      insertContent.run(lesson.id, userId, pack.language, lesson.title, lesson.body, clock.now());
    });
    return { inserted };
  }

  function lessons(language: string): StoredLesson[] {
    return (listLessons.all(userId, language) as unknown as LessonRow[]).map(rowToLesson);
  }

  const nextPending = db.prepare(
    `SELECT * FROM bootstrap_lessons
     WHERE user_id = ? AND language = ? AND status = 'pending'
     ORDER BY seq LIMIT 1`,
  );
  const currentPushed = db.prepare(
    `SELECT * FROM bootstrap_lessons
     WHERE user_id = ? AND language = ? AND status = 'pushed'
     ORDER BY seq LIMIT 1`,
  );
  const countPackLessons = db.prepare(
    `SELECT COUNT(*) AS n FROM bootstrap_lessons
     WHERE user_id = ? AND language = ? AND pack_id = ?`,
  );
  const markPushed = db.prepare(
    `UPDATE bootstrap_lessons
     SET status = 'pushed', chunk_ids = ?, message_id = ?, pushed_at = ?
     WHERE id = ?`,
  );
  const markPrelearned = db.prepare(
    `UPDATE bootstrap_lessons SET status = 'prelearned', prelearned_at = ? WHERE id = ?`,
  );

  function pendingLesson(language: string): StoredLesson | null {
    const row = currentPushed.get(userId, language) as LessonRow | undefined;
    return row ? rowToLesson(row) : null;
  }

  function pushNextLesson(language: string): PushedLesson | null {
    // 完成闸门：有课待预学完成时不推新课——推送严格按序（故事 11），
    // 未完成不堆债（故事 40）。
    if (pendingLesson(language)) return null;
    const row = nextPending.get(userId, language) as LessonRow | undefined;
    if (!row) return null;
    const lesson = rowToLesson(row);

    // 课包语块是系统策展的正式语块：推送即入调度（ADR-0016 候选 → 正式 →
    // 预学完成）。候选/额度闸门管的是内容管道提取的流入，不是固定课包。
    const chunkIds = lesson.chunks.map(
      (chunk) =>
        chunks.registerChunk({
          form: chunk.form,
          chunkType: chunk.chunkType,
          language,
          slotPattern: chunk.slotPattern,
          variants: chunk.variants,
          cefr: chunk.cefr,
          sourceContentId: lesson.id,
          status: "enrolled",
        }).id,
    );
    chunks.scanContent(lesson.id);

    const { n: total } = countPackLessons.get(userId, language, lesson.packId) as { n: number };
    const message = messages.append({
      language,
      contact: "system",
      role: "assistant",
      text: renderLessonPush(lesson, total),
    });
    const pushedAt = clock.now();
    markPushed.run(JSON.stringify(chunkIds), message.id, pushedAt, lesson.id);

    return {
      lesson: { ...lesson, chunkIds, messageId: message.id, status: "pushed", pushedAt },
      chunkIds,
      message,
    };
  }

  function completePreLearning(language: string): CompletedPreLearning | null {
    const lesson = pendingLesson(language);
    if (!lesson) return null;
    const chunkIds = lesson.chunkIds ?? [];
    const events = openEventStore({ db, clock, userId });
    // 观测 id 确定性：同一课的预学完成即使重放也沿版本链取代，不重复计数。
    const recorded = chunkIds.map((chunkId) =>
      events.recordInitialLearning({
        observationId: `prelearning-${lesson.id}-${chunkId}`,
        chunkId,
      }),
    );
    const prelearnedAt = clock.now();
    markPrelearned.run(prelearnedAt, lesson.id);
    return { lesson: { ...lesson, status: "prelearned", prelearnedAt }, events: recorded };
  }

  return { seedPack, lessons, pushNextLesson, pendingLesson, completePreLearning };
}
