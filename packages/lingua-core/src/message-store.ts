import type { Clock } from "./clock";
import type { Database } from "./database";

// 双联系人 IM 消息存储（issue #5）：系统 + 好友角色两个会话的消息流水，
// 角色消息的翻译字段单独存放，壳层据此渲染可展开折叠。

export type ChatContact = "system" | "companion";
export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  language: string;
  contact: ChatContact;
  role: ChatRole;
  text: string;
  translation: string | null;
  createdAt: number;
};

export type MessageStore = {
  append(input: {
    language: string;
    contact: ChatContact;
    role: ChatRole;
    text: string;
    translation?: string | null;
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
    createdAt: row.created_at,
  };
}

export function openMessageStore(options: MessageStoreOptions): MessageStore {
  const { db, clock } = options;
  return {
    append(input) {
      const id = clock.newId();
      const createdAt = clock.now();
      db.prepare(
        `INSERT INTO messages (id, language, contact, role, text, translation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.language,
        input.contact,
        input.role,
        input.text,
        input.translation ?? null,
        createdAt,
      );
      return {
        id,
        language: input.language,
        contact: input.contact,
        role: input.role,
        text: input.text,
        translation: input.translation ?? null,
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
