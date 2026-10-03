import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkConfigPermissions, redactConfig, SECRET_MASK } from "../src/index";

describe("redactConfig", () => {
  it("masks *_key values with a fixed mask and keeps everything else readable", () => {
    const config = {
      models: {
        main: {
          provider: "deepseek",
          model: "deepseek-chat",
          api_key: "sk-real-secret-value",
          base_url: "https://api.deepseek.com/v1",
        },
      },
    };

    const redacted = redactConfig(config);

    expect(redacted).toEqual({
      models: {
        main: {
          provider: "deepseek",
          model: "deepseek-chat",
          api_key: SECRET_MASK,
          base_url: "https://api.deepseek.com/v1",
        },
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("sk-real-secret-value");
  });

  it("recurses into arrays and nested objects", () => {
    const config = {
      providers: [{ name: "a", api_key: "secret-a" }, { name: "b", api_key: "secret-b" }],
    };

    const redacted = redactConfig(config);

    expect(redacted.providers).toEqual([
      { name: "a", api_key: SECRET_MASK },
      { name: "b", api_key: SECRET_MASK },
    ]);
  });

  it("keeps an empty *_key value empty so unset stays distinguishable from set", () => {
    expect(redactConfig({ api_key: "" })).toEqual({ api_key: "" });
  });

  it("does not mutate the input", () => {
    const config = { models: { main: { api_key: "sk-x" } } };

    redactConfig(config);

    expect(config.models.main.api_key).toBe("sk-x");
  });

  it("matches key names case-insensitively but does not flag lookalike words", () => {
    const redacted = redactConfig({ API_KEY: "sk-x", key: "sk-y", monkey: "banana" });

    expect(redacted).toEqual({ API_KEY: SECRET_MASK, key: SECRET_MASK, monkey: "banana" });
  });
});

describe("checkConfigPermissions", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lingua-config-"));
    configPath = join(dir, "config.toml");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports missing when the config file does not exist", () => {
    const report = checkConfigPermissions(configPath, "linux");

    expect(report.status).toBe("missing");
  });

  it("reports unchecked on Windows: POSIX mode bits do not exist there", () => {
    writeFileSync(configPath, "api_key = \"sk-x\"\n");

    const report = checkConfigPermissions(configPath, "win32");

    expect(report.status).toBe("unchecked");
    expect(report.detail).toContain("NTFS");
  });

  it("reports insecure when group/other hold any permission bits", () => {
    // 默认新建文件在 POSIX 为 0644，在 Windows stat 合成 0666：两种宿主都带组/他人位。
    writeFileSync(configPath, "api_key = \"sk-x\"\n");

    const report = checkConfigPermissions(configPath, "linux");

    expect(report.status).toBe("insecure");
    expect(report.mode! & 0o077).not.toBe(0);
    expect(report.detail).toContain("chmod 600");
  });

  // chmod 在 Windows 上只能切换只读位，造不出 0600/0400；这两个用例只在 POSIX 宿主跑。
  it.skipIf(process.platform === "win32")("accepts 0600 on POSIX", () => {
    writeFileSync(configPath, "api_key = \"sk-x\"\n");
    chmodSync(configPath, 0o600);

    const report = checkConfigPermissions(configPath, "linux");

    expect(report.status).toBe("ok");
    expect(report.mode).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("accepts stricter-than-0600 modes like 0400", () => {
    writeFileSync(configPath, "api_key = \"sk-x\"\n");
    chmodSync(configPath, 0o400);

    const report = checkConfigPermissions(configPath, "linux");

    expect(report.status).toBe("ok");
  });
});
