import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAIN_CONFIG,
  loadConfig,
  loadJudgeSelection,
  persistMainApiKey,
} from "../src/config";

// 壳层配置解析（issue #17 复审）：判分通道选择的 fail-fast 口径——
// 配置文件存在但 judge 段非法时 loadConfig 抛错（不再静默退回主模型 LLM
// 判分）；无配置（注入假模型的 e2e 冒烟）时 loadJudgeSelection 返回
// undefined 落缺省；无 judge 段时默认 LLM 判分由主模型兼任。

const dirs: string[] = [];

function writeConfig(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lingua-config-test-"));
  dirs.push(dir);
  const path = join(dir, "config.toml");
  writeFileSync(path, body, "utf8");
  return path;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const VALID_MAIN = `[models.main]
provider = "deepseek"
model = "deepseek-chat"
api_key = "sk-test"
base_url = "https://api.deepseek.com"
`;

describe("loadConfig：judge 段校验（fail-fast，issue #17 复审）", () => {
  it("无 [models.judge] 段：默认 LLM 判分由主模型兼任", () => {
    const config = loadConfig(writeConfig(VALID_MAIN));
    expect(config.judge).toEqual({
      kind: "llm",
      judge: {
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-test",
        baseUrl: "https://api.deepseek.com",
      },
    });
  });

  it("合法的 jev 段：装配 Jev 主判分 + 主模型兼任降级", () => {
    const config = loadConfig(
      writeConfig(
        `${VALID_MAIN}\n[models.judge]\nprovider = "jev"\napi_key = "jev-key"\n`,
      ),
    );
    expect(config.judge.kind).toBe("jev");
    if (config.judge.kind === "jev") {
      expect(config.judge.apiKey).toBe("jev-key");
      expect(config.judge.fallback.model).toBe("deepseek-chat");
    }
  });

  it("judge 段非法（provider = jev 但 api_key 为空）：抛错而非静默退回", () => {
    expect(() =>
      loadConfig(writeConfig(`${VALID_MAIN}\n[models.judge]\nprovider = "jev"\n`)),
    ).toThrow(/api_key/);
  });

  it("judge 段非法（缺 provider）：抛错而非静默退回", () => {
    expect(() =>
      loadConfig(writeConfig(`${VALID_MAIN}\n[models.judge]\nmodel = "qwen-flash"\n`)),
    ).toThrow(/provider/);
  });
});

describe("loadJudgeSelection：只取判分选择，不重复解析", () => {
  it("传入已解析配置时原样返回 judge 选择", () => {
    const config = loadConfig(writeConfig(VALID_MAIN));
    expect(loadJudgeSelection(config)).toEqual(config.judge);
  });

  it("无配置（e2e 注入假模型路径）：返回 undefined 落缺省", () => {
    expect(loadJudgeSelection(undefined)).toBeUndefined();
  });
});

describe("零配置启动：无密钥可启动，运行时可补钥", () => {
  it("api_key 为空字符串：合法，进入未配置模型状态", () => {
    const path = writeConfig(VALID_MAIN.replace('api_key = "sk-test"', 'api_key = ""'));
    const config = loadConfig(path);
    expect(config.main.apiKey).toBe("");
    expect(config.judge).toEqual({
      kind: "llm",
      judge: { ...config.main },
    });
  });

  it("配置文件不存在：返回默认配置（deepseek 默认 + 空密钥），不抛错", () => {
    const dir = mkdtempSync(join(tmpdir(), "lingua-config-test-"));
    dirs.push(dir);
    const config = loadConfig(join(dir, "不存在.toml"));
    expect(config.main).toEqual(DEFAULT_MAIN_CONFIG);
    expect(config.judge.kind).toBe("llm");
  });

  it("[models.main] 段缺失：同样落默认值，不阻止启动", () => {
    const config = loadConfig(writeConfig(`[runtime]\nworkspace = "/tmp/x"\n`));
    expect(config.main).toEqual(DEFAULT_MAIN_CONFIG);
  });

  it("persistMainApiKey：写回既有配置（保留其他段），再读回生效", () => {
    const path = writeConfig(`${VALID_MAIN}\n[models.judge]\nprovider = "jev"\napi_key = "jev-key"\n`);
    persistMainApiKey(path, "sk-new-key");
    const text = readFileSync(path, "utf8");
    expect(text).toContain('api_key = "sk-new-key"');
    expect(text).toContain('provider = "jev"');
    const config = loadConfig(path);
    expect(config.main.apiKey).toBe("sk-new-key");
    expect(config.judge.kind).toBe("jev");
  });

  it("persistMainApiKey：文件不存在则连同默认模板生成", () => {
    const dir = mkdtempSync(join(tmpdir(), "lingua-config-test-"));
    dirs.push(dir);
    const path = join(dir, "config.toml");
    persistMainApiKey(path, "sk-first-key");
    const config = loadConfig(path);
    expect(config.main.apiKey).toBe("sk-first-key");
    expect(config.main.provider).toBe("deepseek");
  });
});
