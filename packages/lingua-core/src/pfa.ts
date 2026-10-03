// PFA（Performance Factors Analysis, Pavlik, Cen & Koedinger 2009, AIED pp. 531–538）：
// 每技能点掌握度 = logistic(β + γ·s + ρ·f)，s/f 为该技能点的先前成功/失败计数。
// v1 的技能点（KC）= 语块本身（docs/research/2026-10-02-learner-state-modeling.md 附录 2：
// 保守起步 chunk_id 为 KC，语法点留作可选第二维度）。
export type PfaParams = {
  // β：技能点基础难易（s=f=0 时的 logit）。
  beta: number;
  // γ：每次先前成功的增益。
  gamma: number;
  // ρ：每次先前失败的调整（负值）。
  rho: number;
};

// 默认值由论文 Table 1 示例序列（student a51864）的前三行预测值反解
// （β = logit(p₀)，γ、ρ 由相邻预测差解出），第四、五行独立验证成立；
// test/pfa.test.ts 用论文 Model Pred. 全序列逐行校验。单用户场景无跨学生
// 拟合数据，v1 以此为固定先验（research 附录 1：参数可靠性需自行验证）。
export const DEFAULT_PFA_PARAMS: PfaParams = {
  beta: 0.4298226,
  gamma: 0.1246736,
  rho: -0.1115975,
};

export function logistic(m: number): number {
  return 1 / (1 + Math.exp(-m));
}

export function pfaLogit(params: PfaParams, successes: number, failures: number): number {
  return params.beta + params.gamma * successes + params.rho * failures;
}

export function pfaMastery(params: PfaParams, successes: number, failures: number): number {
  return logistic(pfaLogit(params, successes, failures));
}
