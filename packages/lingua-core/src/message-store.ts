import type { Clock } from "./clock";
import type { Database } from "./database";
import type { RegisterAnnotation } from "./scaffolding";

// 双联系人 IM 消息存储（issue #5）：系统 + 好友角色两个会话的消息流水，
// 角色消息的翻译字段单独存放，壳层据此渲染可展开折叠；
// issue #13 增加语域标注（annotations）。

export type ChatContact = "system" | "companion";
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  language: string;
  contact: ChatContact;
  role: ChatRole;
  text: string;
  translation: string | null;
  annotations: RegisterAnnotation[];
  createdAt: number;
};

export type MessageStore = {
  append(input: {
    language: string;
    contact: ChatContact;
    role: ChatRole;
    text: string;
    translation?: string | null;
    annotations?: RegisterAnnotation[];
  }): ChatMessage;
  // 时间正序；limit 取最近 N 条（仍正序返回）。
  list(options: { language: string; contact: ChatContact; limit?: number }): ChatMessage[];
};

export type MessageStoreOptions = {
  db: Database;
  clock: Clock;
};

type MessageRow = {
  id: string;
  language: string;
  contact: ChatContact;
  role: ChatRole;
  text: string;
  translation: string | null;
  annotations: string;
  created_at: number;
};

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    language: row.language,
    contact: row.contact,
    role: row.role,
    text: row.text,
    translation: row.translation,
    annotations: parseAnnotations(row.annotations),
    createdAt: row.created_at,
  };
}

function parseAnnotations(raw: string): RegisterAnnotation[] {
  try {
    return JSON.parse(raw) as RegisterAnnotation[];
  } catch {
    return [];
  }
}

function serializeAnnotations(annotations: RegisterAnnotation[] | undefined): string {
  return JSON.stringify(annotations ?? []);
}

export function openMessageStore(options: MessageStoreOptions): MessageStore {
  const { db, clock } = options;
  return {
    append(input) {
      const id = clock.newId();
      const createdAt = clock.now();
      const annotations = input.annotations ?? [];
      db.prepare(
        `INSERT INTO messages (id, language, contact, role, text, translation, annotations, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.language,
        input.contact,
        input.role,
        input.text,
        input.translation ?? null,
        serializeAnnotations(annotations),
        createdAt,
      );
      return {
        id,
        language: input.language,
        contact: input.contact,
        role: input.role,
        text: input.text,
        translation: input.translation ?? null,
        annotations,
        createdAt,
      };
    },
    list({ language, contact, limit }) {
      const rows = (
        limit === undefined
          ? db
              .prepare(
                `SELECT * FROM messages WHERE language = ? AND contact = ?
                 ORDER BY created_at, id`,
              )
              .all(language, contact)
          : db
              .prepare(
                `SELECT * FROM (
                   SELECT * FROM messages WHERE language = ? AND contact = ?
                   ORDER BY created_at DESC, id DESC LIMIT ?
                 ) ORDER BY created_at, id`,
              )
              .all(language, contact, limit)
      ) as unknown as MessageRow[];
      return rows.map(rowToMessage);
    },
  };
}
