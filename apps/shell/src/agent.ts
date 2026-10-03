import { generateText, jsonSchema, stepCountIs, tool, type LanguageModel } from "ai";
import {
  addRelationshipFact,
  openMessageStore,
  renderDigest,
  scaffoldingPolicy,
  type CharacterCard,
  type ChatMessage,
  type Clock,
  type Database,
  type ScaffoldingPolicy,
} from "@lingua/core";

// 好友角色 agent loop（issue #5）：Web Chat 直连，无渠道抽象层（ADR-0017）。
// 每轮：持久化用户消息 → renderDigest 注入 → Vercel AI SDK 工具循环 →
// 翻译标记拆分 → 持久化角色消息。

// 角色消息的中文翻译以标记行附加在英文回复之后，壳层拆分为独立字段，
// 前端据此渲染可展开折叠（仅 full-support 档要求模型输出该标记）。
export const TRANSLATION_MARKER = "[[翻译]]";

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

export function buildCompanionPrompt(options: {
  card: CharacterCard;
  policy: ScaffoldingPolicy;
  digestText: string;
}): string {
  const { card, policy, digestText } = options;
  const lines = [
    `You are ${card.name}, the user's close friend — not a tutor, not an assistant.`,
    "",
    `Persona: ${card.persona}`,
    "",
    "How you talk:",
    "- Chat in English. The user is a native Chinese speaker learning English from zero.",
    "- Internet-chat style: short messages, casual, one thought per message. Never lecture.",
    `- Register: stay between ${card.registerRange.from} and ${card.registerRange.to}.`,
    `- ${RESCUE_LINES[policy.l1Rescue]}`,
  ];
  if (card.interests.length > 0) {
    lines.push(`- Shared interests you both like talking about: ${card.interests.join(", ")}.`);
  }
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
};

export function createCompanionAgent(deps: CompanionAgentDeps): CompanionAgent {
  const { model, db, clock, card } = deps;
  const language = card.languagePair.target;
  const messages = openMessageStore({ db, clock });

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

      const policy = scaffoldingPolicy(card.scaffoldingTier);
      const digest = renderDigest({ db, clock, language });
      const system = buildCompanionPrompt({ card, policy, digestText: digest.text });
      const history = messages
        .list({ language, contact: "companion", limit: HISTORY_LIMIT })
        .map((message) => ({ role: message.role, content: message.text }) as const);

      const result = await generateText({
        model,
        system,
        messages: history.map((message) => ({ ...message })),
        tools: { remember_fact: rememberFact },
        stopWhen: stepCountIs(3),
      });

      const { text, translation } = splitCompanionText(result.text);
      return messages.append({
        language,
        contact: "companion",
        role: "assistant",
        text,
        translation: policy.attachL1Translation ? translation : null,
      });
    },
  };
}
