import type { Clock } from "./clock";
import { matchChunks, SUPPORTED_CHUNK_TYPES } from "./chunk-matching";
import type { ChunkDescriptor, ChunkOccurrence, ChunkScan } from "./chunk-matching";
import type { Database } from "./database";
import { tokenize } from "./lemmatizer";

// 语块身份（MVP 修订 5）：规范形式 + 允许变体 + 槽位模式构成一个身份；
// 同一身份只对应 chunks 表里的一行，出现记录落在 chunk_occurrences。
// 归一探测按序进行：规范形式同键 → 变体同键 → 互为槽位模式实例。
// 先入者持有身份：归一时保留既有行的 id / status / created_at，
// 新信息（变体、槽位模式）以增补方式并入。

export type ChunkType = "collocation" | "idiom";
export type ChunkStatus = "candidate" | "enrolled";

export type Chunk = {
  id: string;
  userId: string;
  language: string;
  canonicalForm: string;
  chunkType: ChunkType;
  cefr: string | null;
  variants: string[];
  slotPattern: string | null;
  sourceContentId: string | null;
  status: ChunkStatus;
  createdAt: number;
};

export type RegisterChunkInput = {
  form: string;
  // 允许任意字符串：提取器可能产出 v1 之外的类型，注册时校验并给出明确错误。
  chunkType: ChunkType | (string & {});
  language: string;
  slotPattern?: string | null;
  variants?: string[];
  cefr?: string | null;
  sourceContentId?: string | null;
  status?: ChunkStatus;
};

export type ChunkStore = {
  registerChunk(input: RegisterChunkInput): Chunk;
  // 扫描内容正文：对同语言全部语块做 token 区间匹配，出现记录整体替换落库
  // （派生数据，重扫幂等），返回出现记录与每个语块的扫描状态。
  scanContent(contentId: string): ContentScan;
  listOccurrences(chunkId: string): StoredOccurrence[];
};

export type StoredOccurrence = Omit<ChunkOccurrence, "startChar" | "endChar"> & {
  id: string;
  contentId: string;
  createdAt: number;
};

export type ContentScan = {
  contentId: string;
  // 扫描当次的出现记录带 char 偏移（便于即取即用）；落库的定位基准是 token 区间，
  // char 偏移可由正文重算。
  occurrences: (StoredOccurrence & { startChar: number; endChar: number })[];
  scans: ChunkScan[];
};

export type ChunkStoreOptions = {
  db: Database;
  clock: Clock;
  userId?: string;
};

export type ChunkRow = {
  id: string;
  user_id: string;
  language: string;
  canonical_form: string;
  chunk_type: ChunkType;
  cefr: string | null;
  variants: string;
  slot_pattern: string | null;
  source_content_id: string | null;
  status: ChunkStatus;
  created_at: number;
};

export function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    userId: row.user_id,
    language: row.language,
    canonicalForm: row.canonical_form,
    chunkType: row.chunk_type,
    cefr: row.cefr,
    variants: JSON.parse(row.variants) as string[],
    slotPattern: row.slot_pattern,
    sourceContentId: row.source_content_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

// 身份键 = 规范形式还原后的 lemma 序列；slot pattern 归一化后另行比较。
function identityKey(form: string): string {
  return tokenize(form)
    .map((token) => token.lemma)
    .join(" ");
}

// form 是否完整落入 descriptor 的匹配（槽位模式的实例判定）。
function isFullInstance(form: string, descriptor: ChunkDescriptor): boolean {
  const tokenCount = tokenize(form).length;
  return matchChunks(form, [descriptor]).occurrences.some(
    (occurrence) => occurrence.startToken === 0 && occurrence.endToken === tokenCount,
  );
}

export function openChunkStore(options: ChunkStoreOptions): ChunkStore {
  const { db, clock } = options;
  const userId = options.userId ?? "local";

  const listByLanguage = db.prepare(
    "SELECT * FROM chunks WHERE user_id = ? AND language = ?",
  );
  const insert = db.prepare(
    `INSERT INTO chunks (
       id, user_id, language, canonical_form, chunk_type, cefr,
       variants, slot_pattern, source_content_id, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateIdentity = db.prepare(
    `UPDATE chunks SET variants = ?, slot_pattern = ?, cefr = ?, source_content_id = ?
     WHERE id = ?`,
  );

  function registerChunk(input: RegisterChunkInput): Chunk {
    if (!SUPPORTED_CHUNK_TYPES.has(input.chunkType)) {
      throw new Error(
        `unsupported chunk type for v1: ${input.chunkType} (supported: collocation | idiom)`,
      );
    }
    const form = input.form.trim().toLowerCase();
    const formKey = identityKey(form);
    if (formKey.length === 0) {
      throw new Error(`chunk form has no matchable tokens: ${input.form}`);
    }

    const existing = (listByLanguage.all(userId, input.language) as unknown as ChunkRow[]).map(
      rowToChunk,
    );
    const inputDescriptor: ChunkDescriptor = {
      id: "(proposed)",
      canonicalForm: form,
      chunkType: input.chunkType,
      variants: input.variants ?? [],
      slotPattern: input.slotPattern ?? null,
    };

    const found = existing.find((chunk) => {
      // 类型是身份的一部分：同形不同类（如 break down 搭配 vs 惯用语）不归一。
      if (chunk.chunkType !== input.chunkType) return false;
      if (identityKey(chunk.canonicalForm) === formKey) return true;
      if (chunk.variants.some((variant) => identityKey(variant) === formKey)) return true;
      // 新形式是既有槽位模式的实例：look it up ∈ look ___ up。
      if (
        chunk.slotPattern &&
        isFullInstance(form, {
          id: chunk.id,
          canonicalForm: chunk.canonicalForm,
          chunkType: chunk.chunkType,
          slotPattern: chunk.slotPattern,
        })
      ) {
        return true;
      }
      // 反向：新输入带来槽位模式，既有规范形式/变体是它的实例。
      if (
        input.slotPattern &&
        [chunk.canonicalForm, ...chunk.variants].some((knownForm) =>
          isFullInstance(knownForm, inputDescriptor),
        )
      ) {
        return true;
      }
      return false;
    });

    if (found) {
      const variants = [...new Set([...found.variants, ...(input.variants ?? [])])];
      if (formKey !== identityKey(found.canonicalForm) && !variants.some((v) => identityKey(v) === formKey)) {
        variants.push(form);
      }
      const slotPattern = found.slotPattern ?? input.slotPattern ?? null;
      const cefr = found.cefr ?? input.cefr ?? null;
      const sourceContentId = found.sourceContentId ?? input.sourceContentId ?? null;
      updateIdentity.run(
        JSON.stringify(variants),
        slotPattern,
        cefr,
        sourceContentId,
        found.id,
      );
      return { ...found, variants, slotPattern, cefr, sourceContentId };
    }

    const chunk: Chunk = {
      id: clock.newId(),
      userId,
      language: input.language,
      canonicalForm: form,
      chunkType: input.chunkType as ChunkType,
      cefr: input.cefr ?? null,
      variants: [...new Set(input.variants ?? [])],
      slotPattern: input.slotPattern ?? null,
      sourceContentId: input.sourceContentId ?? null,
      status: input.status ?? "candidate",
      createdAt: clock.now(),
    };
    insert.run(
      chunk.id,
      chunk.userId,
      chunk.language,
      chunk.canonicalForm,
      chunk.chunkType,
      chunk.cefr,
      JSON.stringify(chunk.variants),
      chunk.slotPattern,
      chunk.sourceContentId,
      chunk.status,
      chunk.createdAt,
    );
    return chunk;
  }

  const getContent = db.prepare(
    "SELECT language, body FROM content_items WHERE id = ? AND user_id = ?",
  );
  const deleteOccurrences = db.prepare(
    "DELETE FROM chunk_occurrences WHERE user_id = ? AND content_id = ?",
  );
  const insertOccurrence = db.prepare(
    `INSERT INTO chunk_occurrences (
       id, user_id, language, chunk_id, content_id,
       start_token, end_token, surface, matched_form, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectOccurrences = db.prepare(
    `SELECT * FROM chunk_occurrences WHERE user_id = ? AND chunk_id = ?
     ORDER BY created_at, id`,
  );

  function scanContent(contentId: string): ContentScan {
    const content = getContent.get(contentId, userId) as
      | { language: string; body: string | null }
      | undefined;
    if (!content) {
      throw new Error(`unknown content: ${contentId}`);
    }
    const body = content.body ?? "";
    const descriptors: ChunkDescriptor[] = (
      listByLanguage.all(userId, content.language) as unknown as ChunkRow[]
    )
      .map(rowToChunk)
      .map((chunk) => ({
        id: chunk.id,
        canonicalForm: chunk.canonicalForm,
        chunkType: chunk.chunkType,
        variants: chunk.variants,
        slotPattern: chunk.slotPattern,
      }));

    const { occurrences, scans } = matchChunks(body, descriptors);

    deleteOccurrences.run(userId, contentId);
    const stored: ContentScan["occurrences"] = occurrences.map((occurrence) => ({
      ...occurrence,
      id: clock.newId(),
      contentId,
      createdAt: clock.now(),
    }));
    for (const occurrence of stored) {
      insertOccurrence.run(
        occurrence.id,
        userId,
        content.language,
        occurrence.chunkId,
        contentId,
        occurrence.startToken,
        occurrence.endToken,
        occurrence.surface,
        occurrence.matchedForm,
        occurrence.createdAt,
      );
    }
    return { contentId, occurrences: stored, scans };
  }

  function listOccurrences(chunkId: string): StoredOccurrence[] {
    const rows = selectOccurrences.all(userId, chunkId) as unknown as {
      id: string;
      chunk_id: string;
      content_id: string;
      start_token: number;
      end_token: number;
      surface: string;
      matched_form: string;
      created_at: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      chunkId: row.chunk_id,
      contentId: row.content_id,
      startToken: row.start_token,
      endToken: row.end_token,
      surface: row.surface,
      matchedForm: row.matched_form,
      createdAt: row.created_at,
    }));
  }

  return { registerChunk, scanContent, listOccurrences };
}
