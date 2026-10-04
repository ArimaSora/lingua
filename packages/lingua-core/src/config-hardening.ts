import { existsSync, statSync } from "node:fs";

// 配置加固（issue #15）：密钥永不进入日志与界面（docs/specs/mvp.md
// Further Notes：密钥与个人学习数据永不入库、不外泄）。
// redactConfig 用于一切将要打印/展示的配置输出；权限检查见本文件下半部分。

/** 密钥字段的固定掩码：定长，不泄露密钥长度或任何片段 */
export const SECRET_MASK = "********";

// *_key（大小写不敏感）与单独的 key 视为密钥字段；monkey 之类的词不匹配。
function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "key" || lower.endsWith("_key");
}

function maskValue(value: unknown): unknown {
  // 空字符串视为「未设置」，原样保留以便设置界面区分已存/未存。
  return typeof value === "string" && value !== "" ? SECRET_MASK : value;
}

/**
 * 深拷贝一份配置，把 *_key 字段的非空值替换为固定掩码。
 * 输入不被修改；日志、设置界面等任何对外输出必须经过此函数。
 */
export function redactConfig<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactConfig(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? maskValue(item) : redactConfig(item);
    }
    return out as T;
  }
  return value;
}

export type ConfigPermissionStatus = "ok" | "insecure" | "unchecked" | "missing";

export interface ConfigPermissionReport {
  status: ConfigPermissionStatus;
  path: string;
  platform: NodeJS.Platform;
  /** 实际 stat 到的 POSIX 权限位（仅 POSIX 平台校验时存在） */
  mode?: number;
  /** 面向用户的中文说明 */
  detail: string;
}

/**
 * 校验配置文件权限应为 0600（仅本人可读写）。
 * POSIX 上 stat 校验：组/他人持有任何权限位即 insecure；
 * 比 0600 更严（如 0400）同样接受。
 * Windows 无 POSIX 权限位（chmod 仅能切换只读属性），无法校验，
 * 返回 unchecked——依赖 NTFS ACL（用户目录默认仅本人可读），
 * 并提醒不要把密钥文件放进共享目录。
 */
export function checkConfigPermissions(
  path: string,
  platform: NodeJS.Platform = process.platform,
): ConfigPermissionReport {
  if (!existsSync(path)) {
    return { status: "missing", path, platform, detail: `配置文件不存在：${path}` };
  }
  if (platform === "win32") {
    return {
      status: "unchecked",
      path,
      platform,
      detail:
        `Windows 无 POSIX 权限位，无法校验 0600；请确认 ${path} 位于当前用户目录内` +
        `（NTFS ACL 默认仅本人可读），不要将密钥文件放进共享目录。`,
    };
  }
  const mode = statSync(path).mode & 0o777;
  const octal = mode.toString(8).padStart(3, "0");
  if ((mode & 0o077) !== 0) {
    return {
      status: "insecure",
      path,
      platform,
      mode,
      detail: `权限位 ${octal} 过于开放：密钥文件应仅本人可读写，请执行 chmod 600 ${path}`,
    };
  }
  return {
    status: "ok",
    path,
    platform,
    mode,
    detail: `权限位 ${octal}，仅本人可访问。`,
  };
}
