import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parseJudgeSelection, type JudgeSelection } from "@lingua/core";
import { dataDir } from "./data-dir";

// 壳层配置（TOML）：主模型的 OpenAI 兼容配置项（ADR-0010）。
// config.toml 永不入库（.gitignore），查找顺序：
// LINGUA_CONFIG 环境变量 → ./config.toml → 数据目录/config.toml（lingua init 生成处）。
//
// 零配置启动：找不到配置文件或 api_key 为空时不再拒绝启动——壳层以
// 「未配置模型」状态运行（角色对话/讲解/判分降级/改写给出指引性报错），
// 密钥可在启动后经系统会话「设置密钥」命令填入并即刻生效（model-registry）。

export type MainModelConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
};

// [models.main] 缺省值：找不到配置文件或该段缺失时使用（apiKey 为空 =
// 未配置模型，运行时会话内提示补钥）。
export const DEFAULT_MAIN_CONFIG: MainModelConfig = {
  provider: "deepseek",
  model: "deepseek-chat",
  apiKey: "",
  baseUrl: "https://api.deepseek.com/v1",
};

export type ShellConfig = {
  main: MainModelConfig;
  // 判分通道选择（issue #17，ADR-0010）：jev = Jev 主判分 + LLM 降级；
  // llm = 纯 LLM 判分。解析规则（合法/非法值校验）在 core parseJudgeSelection，
  // 这里只搬运 TOML 原始表。
  judge: JudgeSelection;
};

export function resolveHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function findConfigPath(): string | null {
  if (process.env.LINGUA_CONFIG) return resolve(process.env.LINGUA_CONFIG);
  for (const candidate of [resolve("config.toml"), join(dataDir(), "config.toml")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function fail(reason: string): never {
  throw new Error(`配置错误：${reason}（参见 config.example.toml）`);
}

export function loadConfig(path?: string): ShellConfig {
  const configPath = path ?? findConfigPath();
  if (!configPath || !existsSync(configPath)) {
    // 零配置启动：无配置文件 → 全默认值（未配置模型状态）。
    return {
      main: { ...DEFAULT_MAIN_CONFIG },
      judge: parseJudgeSelection(undefined, undefined, { ...DEFAULT_MAIN_CONFIG }),
    };
  }
  let raw: unknown;
  try {
    raw = parseToml(readFileSync(configPath, "utf8"));
  } catch (error) {
    return fail(`${configPath} 不是合法 TOML：${(error as Error).message}`);
  }
  const root = raw as Record<string, unknown>;
  const models = root.models as Record<string, unknown> | undefined;
  const main = models?.main as Record<string, unknown> | undefined;
  if (!main) {
    // 段缺失同样落默认值，不阻止启动。
    return {
      main: { ...DEFAULT_MAIN_CONFIG },
      judge: parseJudgeSelection(models?.judge, models?.judge_fallback, {
        ...DEFAULT_MAIN_CONFIG,
      }),
    };
  }
  for (const key of ["provider", "model", "base_url"] as const) {
    if (typeof main[key] !== "string" || (main[key] as string).length === 0) {
      return fail(`[models.main] 缺 ${key}`);
    }
  }
  // api_key 允许为空字符串 = 未配置模型（启动后填）；但类型必须正确。
  if (main.api_key !== undefined && typeof main.api_key !== "string") {
    return fail("[models.main] api_key 必须是字符串");
  }
  const mainConfig: MainModelConfig = {
    provider: main.provider as string,
    model: main.model as string,
    apiKey: (main.api_key as string | undefined) ?? "",
    baseUrl: main.base_url as string,
  };
  let judge: JudgeSelection;
  try {
    judge = parseJudgeSelection(models?.judge, models?.judge_fallback, mainConfig);
  } catch (error) {
    return fail((error as Error).message);
  }
  return { main: mainConfig, judge };
}

// 把主模型密钥写回 config.toml（保留既有其他段；文件不存在则连同默认
// 模板一起生成）。TOML round-trip 会丢注释——接受此代价，密钥不落库原则
// 指 git 仓库，本文件在数据目录/工作区且已被 .gitignore。
export function persistMainApiKey(configPath: string, apiKey: string): void {
  let root: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      root = parseToml(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      root = {};
    }
  }
  const models = (root.models ?? {}) as Record<string, unknown>;
  const main = (models.main ?? {}) as Record<string, unknown>;
  root.models = {
    ...models,
    main: {
      ...main,
      provider: main.provider ?? DEFAULT_MAIN_CONFIG.provider,
      model: main.model ?? DEFAULT_MAIN_CONFIG.model,
      base_url: main.base_url ?? DEFAULT_MAIN_CONFIG.baseUrl,
      api_key: apiKey,
    },
  };
  writeFileSync(configPath, stringifyToml(root), { mode: 0o600 });
}
// 只取判分通道选择（issue #17 复审）：传入 loadConfig 已解析的结果，不重复
// 解析。fail-fast 口径与同文件 loadConfig 一致：
// - 配置文件存在但 judge 段非法 → loadConfig 解析时已抛错（静默退回主模型
//   LLM 判分会让用户以为 jev 已生效，不再吞错）；
// - 无配置（server 注入假模型的 e2e 冒烟路径）→ 返回 undefined，落缺省 LLM
//   判分（主模型兼任）。
export function loadJudgeSelection(config?: ShellConfig): JudgeSelection | undefined {
  return config?.judge;
}
