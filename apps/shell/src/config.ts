import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parseJudgeSelection, type JudgeSelection } from "@lingua/core";
import { dataDir } from "./data-dir";

// 壳层配置（TOML）：主模型的 OpenAI 兼容配置项（ADR-0010）。
// config.toml 永不入库（.gitignore），查找顺序：
// LINGUA_CONFIG 环境变量 → ./config.toml → 数据目录/config.toml（lingua init 生成处）。

export type MainModelConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
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
    return fail(
      "找不到 config.toml——请复制 config.example.toml 为 config.toml 并填入 api_key",
    );
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
  if (!main) return fail("缺 [models.main] 段");
  for (const key of ["provider", "model", "base_url"] as const) {
    if (typeof main[key] !== "string" || (main[key] as string).length === 0) {
      return fail(`[models.main] 缺 ${key}`);
    }
  }
  if (typeof main.api_key !== "string" || main.api_key.length === 0) {
    return fail("[models.main] api_key 为空——填入密钥后再启动（如 DeepSeek key）");
  }
  const mainConfig: MainModelConfig = {
    provider: main.provider as string,
    model: main.model as string,
    apiKey: main.api_key,
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

// 只取判分通道选择（issue #17）：配置缺失 / 非法时返回 undefined（落缺省 LLM
// 判分），让模型装配处的既有报错负责兜底；注入假模型（e2e 冒烟）时 server 不传
// path 直接跳过。
export function loadJudgeSelection(path?: string): JudgeSelection | undefined {
  try {
    return loadConfig(path).judge;
  } catch {
    return undefined;
  }
}
