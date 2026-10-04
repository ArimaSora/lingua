import { generateText, jsonSchema, stepCountIs, tool, type LanguageModel } from "ai";
import {
  addRelationshipFact,
  effectiveRegisterRange,
  getScaffoldingTier,
  openExplanationLog,
  openMessageStore,
  renderDigest,
  renderExplanation,
  scaffoldingPolicy,
  splitRegisterAnnotations,
  type CharacterCard,
  type ChatMessage,
  type Clock,
  type Database,
  type EvidenceLevel,
  type ExplanationLayer,
  type KnowledgeCatalogItem,
  type KnowledgeStore,
  type Register,
  type ScaffoldingPolicy,
  type ScaffoldingTier,
} from "@lingua/core";

// 好友角色 agent loop（issue #5）：Web Chat 直连，无渠道抽象层（ADR-0017）。
// 每轮：持久化用户消息 → renderDigest 注入 → Vercel AI SDK 工具循环 →
// 翻译标记拆分 → 持久化角色消息。
// 讲解入口（issue #12）：语言问题一律经 lookup_knowledge_entry 工具查条目，
// 讲解内容渲染自条目（ADR-0005），投递记录（条目 ID + 证据等级 + 层）落库。

// 角色消息的中文翻译以标记行附加在英文回复之后，壳层拆分为独立字段，
// 前端据此渲染可展开折叠（仅 full-support 档要求模型输出该标记）。
export const TRANSLATION_MARKER = "[[翻译]]";

export const TOPIC_PROMPT_SECTION = "Conversation topic to raise naturally";
export const RETELL_PROMPT_SECTION = "Article to naturally bring up and retell in plain words";

export function splitCompanionText(raw: string): { text: string; translation: string | null } {
  const index = raw.indexOf(TRANSLATION_MARKER);
  if (index === -1) return { text: raw.trim(), translation: null };
  const text = raw.slice(0, index).trim();
  const translation = raw.slice(index + TRANSLATION_MARKER.length).trim();
  return { text, translation: translation.length > 0 ? translation : null };
}

const RESCUE_LINES: Record<ScaffoldingPolicy["l1Rescue"], string> = {
  unrestricted:
    "If the user writes in Chinese or seems stuck, you may rescue in Chinese, then gently switch back to English.",
  "explicit-request":
    "Use Chinese only when the user explicitly asks for help in Chinese; otherwise stay in English.",
  "clarify-only":
    "Do not switch to Chinese to rescue; if the user's English is unclear, ask a short clarification question in English.",
  none: "Never use Chinese. Everything you say is in English.",
};

function buildKnowledgeSection(catalog: KnowledgeCatalogItem[]): string[] {
  if (catalog.length === 0) return [];
  return [
    "",
    "Language explanations (strict rules):",
    "- When the user asks how an expression, grammar point or register choice works (e.g. \"这个表达怎么回事\", \"为什么这样说\"), you MUST call the lookup_knowledge_entry tool first and base your explanation strictly on the returned entry content. Never invent grammar rules.",
    "- Keep the entry ID citation (e.g. 【grammar-past-simple】) in your reply so the explanation stays traceable.",
    "- The tool returns layer 1 by default (example + one-sentence intuition). Pass layer 2 or 3 only when the user explicitly asks to go deeper (展开/为什么/术语).",
    "- If no entry covers the question, say honestly that the knowledge base does not have it yet — do NOT make up a rule.",
    "Available knowledge entries:",
    ...catalog.map((item) => `- ${item.id}：${item.title}（${item.category}）`),
  ];
}

export function buildCompanionPrompt(options: {
  card: CharacterCard;
  tier: ScaffoldingTier;
  policy: ScaffoldingPolicy;
  digestText: string;
  knowledgeCatalog?: KnowledgeCatalogItem[];
  // 埋伏话题生成提示（issue #07）：来自 lingua-core 的不泄题提示，角色据此
  // 自然起话题；null 表示本轮无话题。
  topicPrompt?: string | null;
  // 角色转述提示（issue #19）：简化失败的易腐难文，角色据此用大白话聊文章要点；
  // null 表示本轮无转述任务。
  retellPrompt?: string | null;
}): string {
  const {
    card,
    tier,
    policy,
    digestText,
    knowledgeCatalog = [],
    topicPrompt = null,
    retellPrompt = null,
  } = options;
  const registerRange = effectiveRegisterRange(tier, card.registerRange);
  const lines = [
    `You are ${card.name}, the user's close friend — not a tutor, not an assistant.`,
    "",
    `Persona: ${card.persona}`,
    "",
    "How you talk:",
    "- Chat in English. The user is a native Chinese speaker learning English from zero.",
    "- Internet-chat style: short messages, casual, one thought per message. Never lecture.",
    `- Register: stay between ${registerRange.from} and ${registerRange.to}.`,
    `- ${RESCUE_LINES[policy.l1Rescue]}`,
  ];
  if (card.interests.length > 0) {
    lines.push(`- Shared interests you both like talking about: ${card.interests.join(", ")}.`);
  }
  lines.push(
    "",
    "Register annotations (issue #13): when you use an expression at the casual or formal end of the range, annotate it with `[[register:<casual|neutral|formal>]]` right before the expression and `[[register:neutral]]` right after. The reader will see a register hint like \"这句很口语\". Do not include the annotation markers in the Chinese translation.",
  );
  if (policy.attachL1Translation) {
    lines.push(
      "",
      `Translation scaffolding (required): after your English reply, output one line containing exactly "${TRANSLATION_MARKER}", then a natural Chinese translation of your entire reply on the following lines. The translation is scaffolding for the reader — keep your English reply itself free of Chinese.`,
    );
  }
  if (digestText.length > 0) {
    lines.push(
      "",
      "Notes about the learner (do not recite these back; use them to pick topics):",
      digestText,
    );
  }
  if (topicPrompt) {
    lines.push(
      "",
      `${TOPIC_PROMPT_SECTION} (weave it in like a friend would; do not mention it is an exercise; do not reveal or translate the target expressions):`,
      topicPrompt,
    );
  }
  if (retellPrompt) {
    lines.push(
      "",
      `${RETELL_PROMPT_SECTION} (share it like a friend sharing something interesting; plain words, invite the user's take; do not quiz or teach):`,
      retellPrompt,
    );
  }
  lines.push(...buildKnowledgeSection(knowledgeCatalog));
  lines.push(
    "",
    "When you learn a durable fact about the user (who they are, what they like, something you did together), call the remember_fact tool once, briefly.",
  );
  return lines.join("\n");
}

// 每轮注入对话的历史条数上限（翻译不回喂： scaffold 只给人看）。
const HISTORY_LIMIT = 40;

export type CompanionAgent = {
  // 持久化用户消息与角色回复，返回角色回复。
  reply(userText: string): Promise<ChatMessage>;
};

export type CompanionAgentDeps = {
  model: LanguageModel;
  db: Database;
  clock: Clock;
  card: CharacterCard;
  knowledge: KnowledgeStore;
  // 埋伏复习接线（issue #07）：结算用户回合 + 提供本轮话题注入提示。
  ambushLoop?: import("./ambush-loop").AmbushLoop;
  // 角色转述接线（issue #19）：提供本轮转述注入提示。
  retellLoop?: import("./retell-loop").RetellLoop;
};

export function createCompanionAgent(deps: CompanionAgentDeps): CompanionAgent {
  const { model, db, clock, card, knowledge } = deps;
  const language = card.languagePair.target;
  const messages = openMessageStore({ db, clock });
  const catalog = knowledge.catalog({ language });

  const rememberFact = tool({
    description:
      "记住一条关于用户的策展事实（身份、兴趣、共同经历），用于维持人设一致性与关系连续性",
    inputSchema: jsonSchema<{ fact: string }>({
      type: "object",
      properties: { fact: { type: "string", description: "一句中文策展事实" } },
      required: ["fact"],
      additionalProperties: false,
    }),
    execute: async ({ fact }) => {
      addRelationshipFact({ db, clock, language, fact, source: "companion" });
      return { ok: true };
    },
  });

  return {
    async reply(userText) {
      messages.append({ language, contact: "companion", role: "user", text: userText });

      // 先结算用户回合（对开场时开放的话题判分）——暴露检测只看本轮之前的
      // 角色消息；判分失败不阻断对话（ambush-loop 内部已吞掉传感器故障）。
      await deps.ambushLoop?.settleUserTurn(userText);

      const { tier: effectiveTier } = getScaffoldingTier({ db, clock, language });
      const policy = scaffoldingPolicy(effectiveTier);
      const digest = renderDigest({ db, clock, language, tier: effectiveTier });
      const topicPrompt = deps.ambushLoop?.topicPromptForTurn() ?? null;
      const retellPrompt = deps.retellLoop?.promptForTurn() ?? null;
      const system = buildCompanionPrompt({
        card,
        tier: effectiveTier,
        policy,
        digestText: digest.text,
        knowledgeCatalog: catalog,
        topicPrompt,
        retellPrompt,
      });
      const history = messages
        .list({ language, contact: "companion", limit: HISTORY_LIMIT })
        .map((message) => ({ role: message.role, content: message.text }) as const);

      // 本轮讲解投递（条目 ID + 证据等级 + 层），随角色回复落库（issue #12）。
      const delivered: { entryId: string; evidenceLevel: EvidenceLevel; layer: ExplanationLayer }[] =
        [];
      const lookupKnowledgeEntry = tool({
        description:
          "查询语言知识条目（讲解的唯一合法来源）：按条目 ID 返回条目内容。回答语言问题时必须先调用本工具，讲解严格依据返回内容并引用条目 ID",
        inputSchema: jsonSchema<{ id: string; layer?: 1 | 2 | 3 }>({
          type: "object",
          properties: {
            id: { type: "string", description: "知识条目 ID（见系统提示中的目录）" },
            layer: {
              type: "number",
              enum: [1, 2, 3],
              description: "呈现层：默认 1（例句+直觉规律）；用户显式深挖时才用 2（展开）或 3（术语）",
            },
          },
          required: ["id"],
          additionalProperties: false,
        }),
        execute: async ({ id, layer }) => {
          const entry = knowledge.get(id);
          if (!entry) {
            return {
              found: false as const,
              id,
              message: "知识库中无此条目：坦白告知用户该语言点暂无条目，不要自行编造规则",
            };
          }
          const depth = (layer ?? 1) as ExplanationLayer;
          if (!delivered.some((item) => item.entryId === entry.id && item.layer === depth)) {
            delivered.push({ entryId: entry.id, evidenceLevel: entry.evidenceLevel, layer: depth });
          }
          return {
            found: true as const,
            id: entry.id,
            layer: depth,
            rendered: renderExplanation(entry, { layer: depth }),
          };
        },
      });

      const result = await generateText({
        model,
        system,
        messages: history.map((message) => ({ ...message })),
        tools: { remember_fact: rememberFact, lookup_knowledge_entry: lookupKnowledgeEntry },
        stopWhen: stepCountIs(3),
      });

      const { text, translation } = splitCompanionText(result.text);
      const { text: cleanText, annotations } = splitRegisterAnnotations(text);
      const replyMessage = messages.append({
        language,
        contact: "companion",
        role: "assistant",
        text: cleanText,
        translation: policy.attachL1Translation ? translation : null,
        annotations,
      });
      if (delivered.length > 0) {
        const log = openExplanationLog({ db, clock });
        for (const item of delivered) {
          log.record({ language, messageId: replyMessage.id, ...item });
        }
      }
      return replyMessage;
    },
  };
}
