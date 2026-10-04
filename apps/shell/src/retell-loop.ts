import type { ContentPipeline } from "@lingua/core";

// 角色转述运行时接线（issue #19 壳层侧，mvp.md 故事 10）：
// 简化失败的易腐难文在 core 生成转述任务；壳层每轮对话取最早一条待投递
// 任务注入角色 system prompt，注入后即标记投递并计 retelling-delivered 埋点
// （埋点在 core 的 markRetellDelivered 内）。每轮最多投递一条，避免刷屏。

export type RetellLoop = {
  // 本轮要注入角色 system prompt 的转述提示；无待投递任务返回 null。
  promptForTurn(): string | null;
};

export function createRetellLoop(deps: { pipeline: ContentPipeline }): RetellLoop {
  return {
    promptForTurn() {
      const pending = deps.pipeline.pendingRetells();
      const task = pending[0];
      if (!task) return null;
      deps.pipeline.markRetellDelivered(task.contentId);
      return task.prompt;
    },
  };
}
