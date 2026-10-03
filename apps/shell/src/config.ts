import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
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
  return {
    main: {
      provider: main.provider as string,
      model: main.model as string,
      apiKey: main.api_key,
      baseUrl: main.base_url as string,
    },
  };
}
