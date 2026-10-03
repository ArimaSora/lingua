import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

export const SCHEMA_VERSION = 6;

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
// Schema v5：bootstrap_lessons + scheduler_tasks——Bootstrap 课包推送状态
// 与调度器周期任务 last_run_at（issue #6）。
// Schema v6：explanation_refs——讲解投递记录，可追溯到知识条目 ID 与证据
// 等级（issue #12）。
// 全部按语言隔离，user_id 预留。
// 版本号占位协调：v5 归票 06（并发施工）；v6 归本票（issue #12）。
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
  {
    version: 4,
    // 双联系人 IM 消息（issue #5）：contact 区分系统/好友角色两个会话；
    // translation 仅存角色消息的可展开中文翻译（A1–A2 档），其余为 NULL。
    sql: `
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        contact TEXT NOT NULL CHECK (contact IN ('system', 'companion')),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        translation TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_messages_contact
        ON messages (language, contact, created_at, id);
    `,
  },
  {
    version: 5,
    // Bootstrap 课包与调度器（issue #6）：bootstrap_lessons 存课的行级状态
    // （pending → pushed → prelearned），chunks 为课包给出的语块描述 JSON，
    // chunk_ids / message_id 在推送时回填；content 本体落在 content_items
    // （同 id），语块 source_content_id 指向它。scheduler_tasks 持久化周期
    // 任务的 last_run_at，间隔跨重启有效；入账不在此（票 04 惰性结算）。
    sql: `
      CREATE TABLE bootstrap_lessons (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        pack_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL
          CHECK (kind IN ('survival-chunks', 'sentence-patterns', 'graded-text')),
        hook TEXT NOT NULL,
        body TEXT NOT NULL,
        chunks TEXT NOT NULL,
        chunk_ids TEXT,
        message_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'pushed', 'prelearned')),
        pushed_at INTEGER,
        prelearned_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_bootstrap_lessons_pack
        ON bootstrap_lessons (user_id, language, pack_id, seq);

      CREATE TABLE scheduler_tasks (
        user_id TEXT NOT NULL DEFAULT 'local',
        task_id TEXT NOT NULL,
        last_run_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, task_id)
      );
    `,
  },
  {
    version: 6,
    // 讲解投递记录（issue #12）：交付的每条讲解可追溯到知识条目 ID +
    // 证据等级 + 呈现层，挂在消息上供抽检。知识条目本体是随仓库分发的
    // 策展内容（CC BY 4.0，文件承载），不落库；此处只存运行时投递事实，
    // evidence_level 按交付时快照冗余存储，条目日后修订不影响历史追溯。
    sql: `
      CREATE TABLE explanation_refs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        language TEXT NOT NULL,
        message_id TEXT NOT NULL REFERENCES messages (id),
        entry_id TEXT NOT NULL,
        evidence_level TEXT NOT NULL
          CHECK (evidence_level IN ('学界共识', '教学性概括', '有争议')),
        layer INTEGER NOT NULL CHECK (layer IN (1, 2, 3)),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_explanation_refs_message
        ON explanation_refs (message_id, created_at, id);
    `,
  },
];

// 供测试与运维断言实际登记的迁移版本（版本号不必连续，见上方协调注释）。
export const MIGRATION_VERSIONS: readonly number[] = MIGRATIONS.map(
  (migration) => migration.version,
);

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
