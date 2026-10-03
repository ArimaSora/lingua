import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

export const SCHEMA_VERSION = 3;

export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

type Migration = {
  version: number;
  sql: string;
};

// Schema v1：语块、事件、内容条目、订阅源、角色卡、关系事实、错误日志、
// 指标事件、学习者档案、参数快照（docs/specs/mvp.md 数据 schema + issue #1）。
// Schema v2：chunk_occurrences——语块实体与其在内容中的出现记录分离（issue #2）。
// Schema v3：admission_accounts——额度账户（ADR-0016），入账惰性结算只存
// 结算进度（last_settled_day）与余额，速率由有效学习历史实时推导。
// 全部按语言隔离，user_id 预留。
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        canonical_form TEXT NOT NULL,
        chunk_type TEXT NOT NULL CHECK (chunk_type IN ('collocation', 'idiom')),
        cefr TEXT CHECK (cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
        variants TEXT NOT NULL DEFAULT '[]',
        slot_pattern TEXT,
        source_content_id TEXT,
        status TEXT NOT NULL DEFAULT 'candidate'
          CHECK (status IN ('candidate', 'enrolled')),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        chunk_id TEXT REFERENCES chunks (id),
        occurred_at INTEGER NOT NULL,
        recorded_at INTEGER NOT NULL,
        topic_id TEXT,
        quote TEXT,
        assistance TEXT CHECK (assistance IN ('none', 'assisted')),
        outcome TEXT CHECK (outcome IN ('correct', 'wrong', 'not-produced')),
        event_type TEXT NOT NULL,
        confidence REAL,
        judge_name TEXT,
        judge_version TEXT,
        params_version TEXT,
        fsrs_rating TEXT CHECK (fsrs_rating IN ('again', 'good')),
        pfa_outcome TEXT CHECK (pfa_outcome IN ('success', 'failure')),
        applied INTEGER NOT NULL DEFAULT 0,
        supersedes_event_id TEXT,
        voids_event_id TEXT,
        void_reason TEXT
      );
      CREATE INDEX idx_events_observation
        ON events (observation_id, recorded_at, event_id);
      CREATE INDEX idx_events_chunk
        ON events (chunk_id, occurred_at, event_id);

      CREATE TABLE content_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        feed_id TEXT,
        source_url TEXT,
        title TEXT,
        body TEXT,
        difficulty_score REAL,
        cefr_estimate TEXT CHECK (cefr_estimate IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
        perishability TEXT CHECK (perishability IN ('perishable', 'evergreen')),
        unlock_level TEXT CHECK (unlock_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
        status TEXT NOT NULL DEFAULT 'inbox',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE feeds (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT,
        kind TEXT NOT NULL DEFAULT 'rss' CHECK (kind IN ('rss', 'podcast')),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE character_cards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        name TEXT NOT NULL,
        persona TEXT NOT NULL DEFAULT '{}',
        interests TEXT NOT NULL DEFAULT '[]',
        scaffolding_tier TEXT,
        register_range TEXT,
        language_pair TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE relationship_facts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        card_id TEXT NOT NULL REFERENCES character_cards (id),
        fact TEXT NOT NULL,
        source TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE error_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        original_text TEXT NOT NULL,
        error_type TEXT,
        topic_id TEXT,
        event_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE metric_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        value REAL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE learner_profiles (
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        cefr_anchor TEXT CHECK (cefr_anchor IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
        scaffolding_tier TEXT,
        language_pair TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, language)
      );

      CREATE TABLE param_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL DEFAULT '*',
        params TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    // 出现记录是派生数据：正文重扫时整体替换（见 chunk-store scanContent），
    // 不像 events 那样 append-only。
    sql: `
      CREATE TABLE chunk_occurrences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        chunk_id TEXT NOT NULL REFERENCES chunks (id),
        content_id TEXT NOT NULL REFERENCES content_items (id),
        start_token INTEGER NOT NULL,
        end_token INTEGER NOT NULL,
        surface TEXT NOT NULL,
        matched_form TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_chunk_occurrences_chunk
        ON chunk_occurrences (chunk_id, content_id);
      CREATE INDEX idx_chunk_occurrences_content
        ON chunk_occurrences (content_id);
    `,
  },
  {
    version: 3,
    // 积压闸口带滞后（>30 暂停、≤20 恢复），paused 是状态位，只能落库。
    sql: `
      CREATE TABLE admission_accounts (
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        last_settled_day INTEGER NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, language)
      );
    `,
  },
];

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      record.run(migration.version, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
