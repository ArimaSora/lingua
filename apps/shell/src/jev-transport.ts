import type { JevSystemOneRequest, JevTransport } from "@lingua/core";

// Jev HTTP transport（issue #17 壳层侧）：把 core 组装好的 System One 请求 POST 到
// endpoint（默认官方直连 https://api.typesafe.ai/v1/systemone；OpenRouter 镜像换
// https://openrouter.ai/api/alpha/decisions）。非 2xx / 网络错误 / 超时一律 throw，
// 由 createFallbackUsageJudge 降级到 LLM 判分（429/529 的重试交给降级路径而不是
// 在这里退避——传感器语义保持简单）。
//
// 超时默认 10s：Jev 标称 70–500ms，这里只防悬挂，不防慢。

export type JevHttpTransportOptions = {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
};

export function createJevHttpTransport(options: JevHttpTransportOptions): JevTransport {
  const endpoint = options.endpoint ?? "https://api.typesafe.ai/v1/systemone";
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (request: JevSystemOneRequest): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Jev 请求超时（${timeoutMs}ms）`);
      }
      throw new Error(`Jev 请求网络失败：${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Jev 响应非 JSON（HTTP ${response.status}）：${text.slice(0, 120)}`);
    }
    if (!response.ok) {
      // 401 密钥错 / 422 请求校验失败 / 429 限流 / 529 过载：统一抛错走降级。
      throw new Error(`Jev 请求失败：HTTP ${response.status}`);
    }
    return payload;
  };
}
