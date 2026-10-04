// 按天聚合共用的日界工具（UTC）：metrics-panel / ambush / system-digest / admission
// 都以「天的起始毫秒」做窗口切分，统一在此实现，避免各自漂移。
export const DAY_MS = 24 * 60 * 60 * 1000;

export function dayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}
