import type { Cefr } from "./bootstrap-pack";
import { tokenize } from "./lemmatizer";
import type { Token } from "./lemmatizer";

// 难度评估三层管道（ADR-0012，对外仅 assess(content)——L1/L2/L3 均为实现细节，ADR-0017）：
//   L1 主力 = CEFR 分级词表累计覆盖率（EFLLex 口径；解锁级 = 首个覆盖率达阈值的级别；
//      词形还原复用判分管道 lemmatizer.ts）。词表经构造注入：EFLLex 是 CC BY-NC-SA，
//      词表数据绝不入库（scripts/download-efllex.mjs + docs/efllex.md），测试用假词表。
//   L2 约束 = 平均句长：L1 定出的 A1 若平均句长超限则上调为 A2（研究 §5.1：
//      cov(≤A1) ≥ 95% 且平均句长 ≤ ~12 词才可 A1 直推）。
//   L3 交叉验证 = LLM 粗评三档（A/B/C），不单独定级：只在给出更难的档位时把级别
//      抬到该档位地板（「两个信号都认为容易才算容易」，研究 §5.2——对学习者更安全
//      的一侧是偏难）；L3 永不下调级别，缺省或出错时跳过。
// 时效标签（易腐/常青）由注入的 tagger 顺手标注（models.main）；无 tagger 时退化为
// 确定性启发式（URL 日期路径、时间状语标记），默认常青。
// 阈值与句长上限都是可校准参数（研究 §5.2：阈值是产品参数而非科学常数）。

export type Perishability = "perishable" | "evergreen";

export type DifficultyInput = {
  text: string;
  // 可选元数据：时效判断的补充信号（启发式兜底与 tagger 均可用）。
  url?: string | undefined;
  publishedAt?: number | undefined;
};

export type DifficultyAssessment = {
  // 难度级 = 解锁级：首个累计覆盖率达阈值的级别（off-list 词计入最难档 C2）。
  level: Cefr;
  // 该级别的累计覆盖率（0–1，按 token 计；豁免词不计入分母）。
  coverage: number;
  perishability: Perishability;
};

// 词表端口：lemma → CEFR 级别（A1–C1；查不到 = off-list，计入最难档 C2）。
export type Wordlist = {
  lookup(lemma: string): Cefr | null;
};

// L3 粗评端口：三档（A = A1–A2，B = B1–B2，C = C1–C2）。
export type CoarseBand = "A" | "B" | "C";

export type CoarseGrader = {
  grade(text: string): Promise<CoarseBand>;
};

// 时效标注端口（「系统顺手标注」的模型适配器挂在壳层）。
export type PerishabilityTagger = {
  tag(input: DifficultyInput): Promise<Perishability>;
};

export type DifficultyPipelineOptions = {
  wordlist: Wordlist;
  grader?: CoarseGrader | null;
  tagger?: PerishabilityTagger | null;
  // L1 解锁级阈值，默认 0.95（ADR-0012）。
  coverageThreshold?: number | undefined;
  // L2 平均句长上限（仅约束 A1），默认 12 词。
  maxA1SentenceLength?: number | undefined;
};

export type DifficultyPipeline = {
  assess(content: DifficultyInput): Promise<DifficultyAssessment>;
};

const LEVEL_ORDER: readonly Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const BAND_FLOOR: Record<CoarseBand, Cefr> = { A: "A1", B: "B1", C: "C1" };

function levelIndex(level: Cefr): number {
  return LEVEL_ORDER.indexOf(level);
}

// 豁免词（RANGE/Duolingo 惯例，研究 §5.2）：数字与句中大写词（专名启发式）。
// 句首大写（index 0 或断句后）是英语常态，不算专名；单字母大写词（I）不豁免。
function isExempt(token: Token): boolean {
  if (/^\d/.test(token.raw)) return true;
  const sentenceStart = token.index === 0 || token.breakBefore;
  return !sentenceStart && token.raw.length > 1 && /^[A-Z]/.test(token.raw);
}

const DATE_PATH_RE = /\/20\d\d[-/]\d{2}([-/]\d{2})?/;
const TEMPORAL_MARKER_RE =
  /\b(breaking|today|yesterday|tonight|this (morning|afternoon|evening|week|weekend|month|year)|last (night|week|month|year)|just (announced|released|launched|published))\b/i;

// 兜底启发式偏保守：找不到时效信号即视为常青；准确标注靠注入的 tagger。
export function heuristicPerishability(input: DifficultyInput): Perishability {
  if (input.url && DATE_PATH_RE.test(input.url)) return "perishable";
  if (TEMPORAL_MARKER_RE.test(input.text)) return "perishable";
  return "evergreen";
}

export function openDifficultyPipeline(options: DifficultyPipelineOptions): DifficultyPipeline {
  const threshold = options.coverageThreshold ?? 0.95;
  const maxA1SentenceLength = options.maxA1SentenceLength ?? 12;
  const grader = options.grader ?? null;
  const tagger = options.tagger ?? null;

  async function assess(content: DifficultyInput): Promise<DifficultyAssessment> {
    const tokens = tokenize(content.text);

    // L1：按 token 统计各级分布（豁免词不进分母），再求累计覆盖率阶梯。
    let counted = 0;
    const perLevel = new Map<Cefr, number>();
    for (const token of tokens) {
      if (isExempt(token)) continue;
      counted += 1;
      const level = options.wordlist.lookup(token.lemma) ?? "C2";
      perLevel.set(level, (perLevel.get(level) ?? 0) + 1);
    }
    const cumulative = new Map<Cefr, number>();
    let acc = 0;
    for (const level of LEVEL_ORDER) {
      acc += perLevel.get(level) ?? 0;
      cumulative.set(level, counted === 0 ? 1 : acc / counted);
    }

    let level = LEVEL_ORDER.find((l) => cumulative.get(l)! >= threshold)!;

    // L2：平均句长约束——只有全表容易（A1）时才可能被句长否决。
    if (level === "A1" && tokens.length > 0) {
      const sentences = 1 + tokens.filter((token) => token.breakBefore).length;
      if (tokens.length / sentences > maxA1SentenceLength) level = "A2";
    }

    // L3：LLM 粗评三档交叉验证——只上调、不下调、不单独定级；出错即跳过。
    if (grader) {
      try {
        const band = await grader.grade(content.text);
        if (levelIndex(BAND_FLOOR[band]) > levelIndex(level)) {
          level = BAND_FLOOR[band];
        }
      } catch {
        // L3 是可选信号：模型不可用/输出不可解析时评估照常产出。
      }
    }

    let perishability: Perishability;
    if (tagger) {
      try {
        perishability = await tagger.tag(content);
      } catch {
        perishability = heuristicPerishability(content);
      }
    } else {
      perishability = heuristicPerishability(content);
    }

    return { level, coverage: cumulative.get(level)!, perishability };
  }

  return { assess };
}
