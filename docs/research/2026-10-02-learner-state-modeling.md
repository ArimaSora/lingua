# 学习者状态建模：LLM 记忆 vs 结构化学习者模型

> 研究日期：2026-10-02
> 背景：语言学习 agent（TypeScript）= 虚拟聊天角色 + 内容学习模块。待验证的架构假设：「记忆系统只用在虚拟角色身上（维持人设与关系连续性）；学习 agent 不用 LLM 记忆系统，而通过其他方式确定用户学习状态。」已定决策：语块（chunk）为学习单位，SRS 用 ts-fsrs，复习嵌在内容复现与聊天话题里，数据存本地 SQLite。
> 方法：结论尽量回溯到一手文献（DOI/期刊官方页/arXiv）或产品官方页面；每条标注证据强度与共识等级；未找到证据的点在附录明确列出。

---

## 1. TL;DR（对架构假设的判定）

**判定：假设成立，且证据比预想更强。** 但需要两处修正。

### 假设成立的三条独立证据链

1. **ITS（智能教学系统）40 年的经典架构共识**：ITS 的标准四模块（领域模型 / 学习者模型 / 教学模型 / 交互界面）中，学习者模型从来都是**结构化、可计算的状态**（掌握概率、能力参数、作答计数），从 Corbett & Anderson (1995) 到今天的 Duolingo 无一例外——它不是"塞进 LLM 上下文的历史文本"。这不是一个设计偏好，而是该领域从未动摇过的架构分离。[Woolf (2009)](https://link.springer.com/content/pdf/10.1007/s40593-021-00266-y.pdf)；[Nkambou et al. (2010) 转引](https://aclanthology.org/2023.bea-1.2.pdf)
2. **2026 年直接实证：LLM 做知识追踪全面输给专用小模型**。一个 2026 年 3 月的对比研究（真实教育平台数据，10 万学生×40 次预测）发现：专用 KT 模型（DKT/SAKT，<1M 参数）准确率 72–73%，而 GPT-4o-mini 只有 58.6%、Gemini-2.5-flash-lite 66.5%——**部分 LLM 甚至跑不赢"猜数据集平均正确率"的朴素基线（66.5%）**；延迟上 LLM 慢数个数量级（每人次 3–3300 秒 vs <0.25 秒）；成本贵 **600–12,400 倍**。["Faster, Cheaper, More Accurate: Specialised Knowledge Tracing Models Outperform LLMs", arXiv:2603.02830](https://arxiv.org/html/2603.02830v1)。这从量化上封死了"用 LLM 记忆/上下文来追踪学习状态"的方案——既不准、又慢、又贵。
3. **长上下文本身损害 LLM 表现**，"少即是多"有实证：Liu et al. (2023/2024, TACL) "Lost in the Middle" 显示模型对位于上下文**中部**的信息利用率呈 U 型塌陷；Levy, Jacoby & Goldberg (2024, ACL) 显示**同一任务仅增加输入 token 数**（从 ~250 到 3000）就使推理准确率单调下降，与内容是否相关无关。[DOI: 10.1162/tacl_a_00638](https://arxiv.org/abs/2307.03172)；[ACL Anthology 2024.acl-long.818](https://aclanthology.org/2024.acl-long.818/)

### 两处修正

1. **"学习状态不靠 LLM"≠"感知层不用 LLM"**。正确的分工是 **LLM as sensor, not as memory**：从自由聊天产出中识别"哪个语块产出成功/失败/自我修正"这件事，只能靠 LLM（或 GEC 模型）做逐轮判分——这是一次性、低成本的分类调用，输出的是结构化计数（`chunk_id, correct, timestamp`）写入 SQLite，而不是把对话历史存进某种"记忆"。Duolingo 的 SLAM 任务（2018）证明这种 per-token 错误是**可预测**的（参赛系统平均 AUC ≈ 0.79，oracle 上界 >0.99）。[Settles et al. 2018](https://research.duolingo.com/papers/settles.slam18.pdf)
2. **角色的"关系记忆"也应最小化**，不是"随便用记忆系统"。Mem0 论文（ECAI 2025）的实测：精选事实检索方案比 full-context 方案 token 成本降低 ~72–90%、p95 延迟降低 91%——关系记忆同样适用"curated facts + 向量检索 top-k"，而不是全文历史。[arXiv:2504.19413](https://arxiv.org/abs/2504.19413)

### 推荐的学习者状态技术栈（具体到模型名）

| 状态维度 | 推荐方案 | 理由 |
|---|---|---|
| 每语块记忆状态（何时复习） | **ts-fsrs**（已定） | 每卡 D/S/R 时间序列，O(1) 更新，本地零成本 |
| 每技能/每类产出掌握度 | **PFA**（Pavlik et al. 2009）：每 KC 的成功/失败计数 → logistic 掌握概率 | 无遗忘假设的 BKT 在语言场景先天不适配；PFA 参数少、可在线更新、解释性强；深度模型（DKT）在多项独立复制中不优于简单模型且单用户场景无训练数据 |
| 全局水平定位（冷启动 + 周期校准） | **轻量 CAT / C-test / 分级 cloze**（Rasch 思想，不需要完整 IRT 标定题库） | C-test 信度 ~0.90 且实现极简（每句挖掉后半词）；DET 证明 CAT 在生产环境可行 |
| 全局暴露量 | **输入时长 + 词汇覆盖计数**（Dreaming Spanish / LingQ 先例） | 零成本标量，适合驱动"内容难度选择" |
| 聊天产出 → 状态信号 | **LLM 判分器**（逐轮，输出结构化计数）+ 查词/延迟等隐式信号 | SLAM 2018 证明错误可预测；眼动研究证明未知词处理时间更长 |
| 全部状态的持久化 | **SQLite 表 + 聚合视图**，渲染成 ≤300 token 的 digest 注入 prompt | ITS 架构共识 + lost-in-the-middle 证据 |

---

## 2. 学习者建模方法对比表

> "输入"= 需要什么行为数据；"输出"= 能读出什么状态；"冷启动"= 新用户/新知识点初期怎么办；"计算"= 每次更新的开销。

| 方法 | 输入 | 输出 | 数据需求 / 冷启动 | 计算成本 | 对本项目适用性 |
|---|---|---|---|---|---|
| **BKT**（贝叶斯知识追踪，[Corbett & Anderson 1995, DOI: 10.1007/BF01099821](https://link.springer.com/article/10.1007/BF01099821)） | 每技能（KC）的对/错二元序列 | 每技能掌握概率 P(learned)（两状态 HMM：掌握/未掌握） | 4 参数（初始掌握/学习率/猜对/失误），通常**跨学生合并估计**；单用户时参数不可靠 | 极低（贝叶斯更新 O(1)） | **有限**：① 标准 BKT **不建模遗忘**（Khajah et al. 2016 需专门加遗忘特征），与 FSRS 重复造轮子；② 掌握/未掌握二分对语言学习的"渐熟"过程太粗；③ 语块数百上千个时，参数按 KC 爆炸。可用于少量"语法点"粒度 |
| **PFA**（表现因素分析，[Pavlik, Cen & Koedinger 2009, AIED, pp. 531–538](https://eric.ed.gov/?id=ED506305)） | 每 KC 的成功次数 s、失败次数 f（可加重量）+ 学生全局能力 ρ | 答对概率 P(correct)=logistic(Σβⱼ+γⱼs+δⱼf+ρ) | 参数少（每 KC 2–3 个），少量数据即可开始；在线梯度更新友好 | 极低 | **推荐**：天然匹配"产出成功/失败计数"这一信号源；连续值、无"已掌握就不再练"的硬切换；与 FSRS 正交（FSRS 管记忆保持，PFA 管产出能力） |
| **DKT**（深度知识追踪，[Piech et al. 2015, NeurIPS](https://proceedings.neurips.cc/paper/2015/hash/bac9162b47c56fc8a4d2a519803d51b3-Abstract.html)） | (题目, 对错) 序列 | 每 KC 下次答对概率（RNN 隐状态） | **需要跨用户大数据集训练**（数千学生×数百交互）；冷启动差；本地单用户无法训练 | 训练重，推理中等 | **不推荐**，且批评密集：Khajah, Lindsey & Mozer (2016, ["How Deep is Knowledge Tracing?" arXiv:1604.02416](https://arxiv.org/abs/1604.02416)) 发现加遗忘/个体化特征的 BKT 即可接近 DKT；[Gervet et al. 2020, JEDM 12(3):31–54](https://jedm.educationaldatamining.org/index.php/JEDM) 系统比较后结论"DKT 的优势被高估，Best-LR 逻辑回归有竞争力"；[Yeung & Yeung 2018, DOI: 10.1145/3231644.3231647](https://dl.acm.org/doi/10.1145/3231644.3231647) 指出 DKT 预测**不可解释且不自洽**（同类输入预测不连续、无法重建输入）；[Sarsa, Leinonen & Hellas 2022, JEDM 14(2), DOI: 10.5281/zenodo.7086179](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/553) 复制研究：深度模型对超参敏感、复现性差 |
| **IRT + CAT**（项目反应理论 + 自适应测试） | 在**已标定参数**的题库上的作答（题目难度/区分度需预估计） | 能力 θ（连续）+ 测量误差 SEM | 题库标定需要每题数百次作答（生产环境做法：Duolingo English Test 用大规模数据标定 + [BERT-IRT 冷启动题目](https://aclanthology.org/2024.bea-1.35.pdf)）；单人产品可用 Rasch + 启发式难度近似 | 估计 θ 为轻量迭代（MLE/EAP） | **用于"定位事件"而非连续追踪**：周期性 cloze/C-test 小测做水平校准。CAT 比固定测验更短且精度均匀（[Weiss & Kingsbury 1984 转引自 DET 技术手册](https://s3.amazonaws.com/duolingo-papers/other/Duolingo English Test - Technical Manual 2019.pdf)）；工程量可控（不必全量 IRT，分级固定小测也可） |
| **FSRS**（Free Spaced Repetition Scheduler，[Ye, Su & Cao 2022, KDD, DOI: 10.1145/3534678.3539081](https://dl.acm.org/doi/10.1145/3534678.3539081)；[Su et al. 2023, IEEE TKDE](https://ieeexplore.ieee.org/document/10059206)；[官方 Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki)） | 每卡复习记录（评分 + 时间戳） | 每卡 D（难度 1–10）/S（稳定性，天）/R（当前回忆概率） | 默认参数开箱即用；个性化参数需数百次复习后优化 | 极低（O(1)/次） | **已定，适用**。边界见 §3 |
| **Elo/Glicko 类评级**（[Pelánek 2017 综述, UMUAI 27:313–350, DOI: 10.1007/s11257-017-9193-2](https://link.springer.com/article/10.1007/s11257-017-9193-2)） | 作答对错 + 题目/语块难度先验 | 学习者单一 rating（± 不确定度） | 几乎零需求；天然在线 | 极低 | **可选加分项**：把"用户 vs 语块难度"做成对弈评级，一行更新公式即可得到全局水平估计；精度低于 PFA/IRT，但实现成本几乎为零 |
| **词汇状态分级**（LingQ 式，[官方支持文档](https://lingq-support.groovehq.com/help/can-you-explain-a-lingqs-status)） | 查词/阅读交互驱动的手工或自动状态迁移 | 每词状态 1(New)–4(Learned) / Known / Ignored | 零训练需求；冷启动即"全部未知" | 零 | **作为交互设计模式采纳**：查词行为驱动初始状态，FSRS/PFA 负责后续演化 |
| **输入时长计数**（Dreaming Spanish 式，[官网](https://www.dreamingspanish.com/)） | 消费的可理解输入小时数（按难度分桶） | 全局标量：累计小时 → 7 级 roadmap（50/150/300/600/1000/1500h） | 零 | 零 | **采纳为辅助维度**：与 CEFR 粗对齐，驱动内容难度推荐；证据为产品实践 + Krashen 输入假说（理论共识高、量化精度低） |

**共识等级说明**：BKT/PFA/IRT/CAT = 教科书级共识（[Pelánek 2017](https://link.springer.com/article/10.1007/s11257-017-9193-2) 为权威综述）；DKT 批评 = 多篇独立复制研究的一致结论，共识度高；Elo/时长法 = 工程实践级。

---

## 3. FSRS 的输出能回答什么、不能回答什么

ts-fsrs（FSRS）为**每张卡**输出三个量：Difficulty（D，1–10）、Stability（S，记忆稳定度，单位天，决定间隔）、Retrievability（R，当前时刻的回忆概率，随时间按幂律衰减）。

**能回答的**（per-item 记忆状态）：
- 这张卡**何时**该复习（调度）；
- 用户此刻有多大可能回忆起这个语块（R）——可用于聊天话题挑选（挑 R 适中的语块做"复现"）；
- 哪些语块是"顽固卡"（D 高、S 增长慢）——可以聚合出"难点列表"。

**不能回答的**：
- **per-skill 掌握度**：FSRS 没有"技能"概念，它不知道"ser vs estar"是一个语法点。要回答"用户在第三人称单数上的产出可靠吗"需要把 per-item 状态**聚合**到 KC 上（平均 R、平均 D、或并行的 PFA）；
- **产出能力 vs 识别能力**：FSRS 评级混在一张卡里时不区分方向（认出 ≠ 能产出）。词汇知识是二维的：Nation 的框架（form/meaning/use × receptive/productive，9 方面 18 格）指出 receptive→productive 不是自动迁移的（[Nation 2013, *Learning Vocabulary in Another Language*, 2nd ed., Cambridge UP, DOI: 10.1017/CBO9781139858656](https://doi.org/10.1017/CBO9781139858656)；实证：Zhong 2018, [ERIC EJ1186015](https://eric.ed.gov/?id=EJ1186015)）。**设计含义：卡片/评分应区分方向（recognition vs production），或至少记录产出场景**；
- **全局水平**：FSRS 不输出"用户大约是 A2 还是 B1"——这需要 CAT/词汇量估计等其他手段（见 §2 与 §5）。

**语言学习特有的遗忘证据**：Ridgeway, Mozer & Bowles (2017, *Cognitive Science* 41(4):924–949, [DOI: 10.1111/cogs.12385](https://onlinelibrary.wiley.com/doi/10.1111/cogs.12385)) 用在线语教软件语料证实外语技能遗忘可被显式建模——支持"SRS 管保持"这一独立子系统的必要性。

---

## 4. 交互信号清单（信号 → 推断 → 证据强度）

| 信号 | 推断什么 | 证据 | 强度 |
|---|---|---|---|
| **聊天中目标语块产出成功/失败**（LLM 判分器逐轮标注） | per-chunk 产出掌握（喂 PFA/FSRS） | Duolingo SLAM 共享任务（2018）：6.4k 学习者 7M 词的错误历史可预测未来错误，参赛系统 AUC≈0.79，oracle>0.99；最有效特征是**用户×词历史计数** | **强**（大规模实证任务，[Settles et al. 2018, DOI: 10.18653/v1/W18-0506](https://aclanthology.org/W18-0506/)） |
| **作答/回复耗时**（response latency） | 提取流畅度、当前项难度 | SLAM 元分析中"response time"是为数不多统计显著的特征之一；阅读眼动研究显示未知词获得更长注视 | **中等偏强**（[Settles et al. 2018](https://aclanthology.org/W18-0506/)；[Godfroid, Boers & Housen 2013, SSLA 35(3):483–517](https://eric.ed.gov/?id=EJ1018135)） |
| **查词行为**（点击词典/问角色"X 是什么意思"） | 该词/块 = 未知（强信号，置信度高）；查后是否记住 = 后续观测 | Laufer & Hill (2000, *Language Learning & Technology* 3(2):58–76)：CALL 词典点击日志被用作词汇学习过程数据（643 次引用，[ERIC ED462834](https://eric.ed.gov/?id=ED462834)）；LingQ 产品十年实践 | **强**（作为"未知"信号）；中等（查过 ≠ 学会） |
| **阅读停顿/回退**（如有阅读界面） | 加工困难位置 → 候选难点 | 眼动文献：L2 读者对未知/低频词注视时间与次数显著更多，且随接触次数递减（[Godfroid et al. 2013](https://eric.ed.gov/?id=EJ1018135)；[Pellicer-Sánchez 2016 转引](https://www.cambridge.org/core/journals/applied-psycholinguistics/article/E29F0A99BDBF82586E2A30C0C5068344)） | **强**（实验室眼动证据）；注意：普通 UI 无法测注视，只能用段落级停留时间近似（弱化为中等） |
| **要求角色重复/简化/切换母语** | 当前输入超出可理解范围 → 下调难度信号 | 互动假说（Long 1996, *Handbook of Second Language Acquisition*；综述见 [Loewen 2018, *Language Teaching*](https://www.cambridge.org/core/journals/language-teaching/article/78A156EE200F744F5978F99BFB073DBE)）：clarification request / comprehension check 是意义协商的核心机制 | 理论共识**强**；作为**自动状态信号**的量化证据弱（未找到"用请求重复频率校准模型"的实证） |
| **自我修正**（用户自己改口） | 注意缺口（noticing）→ 该形式处于"发展中"而非"未习得" | SLA 理论（Swain 输出假说、noticing 假说）支持；自动检测与计数的量化证据**未找到** | **弱-中**（理论支持，工程量化无直接证据，见附录） |
| **自由产出整体水平**（从聊天文本直接估 CEFR） | 全局水平粗估 | 自动水平分类研究：Vajjala & Rama (2018, [BEA 2018, DOI: 10.18653/v1/W18-0515](https://aclanthology.org/W18-0515/)) 跨捷克语/德语/意大利语做通用 CEFR 分类；后续复制（REPROLANG 2020）显示跨任务/跨语言泛化有限 | **中等**：方向可行，但短消息文本量太少、口语聊天与写作语料分布不同；只适合做多信号融合中的一个弱先验 |
| **周期性 cloze/C-test 小测** | 全局水平校准锚点 | C-test 元证据：Eckes & Grotjahn (2006, *Language Testing* 23(3):290–325, [DOI: 10.1191/0265532206lt330oa](https://journals.sagepub.com/doi/10.1191/0265532206lt330oa))，843 被试 4 个样本，信度 ~0.90，与外部考试高相关；"测试即学习"元分析：Adesope et al. (2017, *RER* 87(3):659–701, [DOI: 10.3102/0034654316689306](https://doi.org/10.3102/0034654316689306))，118 项实验；Roediger & Karpicke (2006, [DOI: 10.1111/j.1467-9280.2006.01693.x](https://pubmed.ncbi.nlm.nih.gov/16507066/)) | **强** |
| **词汇量抽样测试**（VST 式，按词频带抽样） | 接收性词汇量估计 | Nation & Beglar (2007, *The Language Teacher* 31(7):9–13)；Beglar (2010, *Language Testing* 27(1):101–118, [DOI: 10.1177/0265532209340194](https://doi.org/10.1177/0265532209340194)) Rasch 验证信度 .96 | **强**；注意选择题猜测会膨胀估计（信度无碍但绝对值偏高，作相对比较足够） |
| **角色"装不懂"请求澄清**（主动探测） | 探测用户能否重述/简化 → 校准产出能力 | 互动假说支持"意义协商促习得"（Long 1996；[Loewen 2018 综述](https://www.cambridge.org/core/journals/language-teaching/article/78A156EE200F744F5978F99BFB073DBE)）；但"作为状态校准手段"的量化证据**未找到** | **弱**（教学设计合理，测量效度未验证，见附录） |

**设计要点**：所有信号落库为**结构化计数/时间戳**（`(signal_type, chunk_id?, value, ts)`），推断逻辑（聚合、加权、衰减）在代码里，不在 LLM 上下文里。

---

## 5. 状态 → LLM 的注入设计（分层 digest 方案）

### 5.1 架构依据

ITS 经典四模块（domain / learner / tutoring / UI，[Woolf 2009 转引](https://link.springer.com/content/pdf/10.1007/s40593-021-00266-y.pdf)）中，学习者模型是独立子系统，教学决策模块**查询**它，而不是把它的原始数据摊在交互界面上。对应到 LLM 应用：learner model = SQLite + 推断代码；tutoring model = 生成 digest 的策略代码；UI = LLM prompt。

注入的证据约束：
- **Lost in the Middle**（[Liu et al. 2023/TACL 2024, DOI: 10.1162/tacl_a_00638](https://arxiv.org/abs/2307.03172)）：关键信息放上下文中部会被系统性忽略 → digest 放 prompt 开头或结尾，且要短；
- **Same Task, More Tokens**（[Levy et al. 2024, ACL, arXiv:2402.14848](https://aclanthology.org/2024.acl-long.818/)）：输入从 250→3000 token 推理准确率单调下降，无关内容同样有害 → **默认不注入原始历史**；
- **Mem0**（[Chhikara et al. 2025, arXiv:2504.19413](https://arxiv.org/abs/2504.19413)）：curated-facts 方案 vs full-context，token 成本 −72%~−90%、p95 延迟 −91%、LOCOMO 准确率反而更高 → "压缩后注入"不仅没有牺牲，反而更好。

### 5.2 建议的三层注入

```
L0 常量层（system prompt，每会话不变，~300–500 tok）
  人设、语言切换规则、教学策略（如何纠错、何时切换难度、如何嵌入复习语块）

L1 学习者 digest（每轮生成，目标 ≤300 tok，放 prompt 尾部贴近用户输入）
  ├─ 水平锚点：CEFR 粗估（A2，置信中）+ 依据（最近 cloze 68%、词汇量估计 ~1.8k）
  ├─ 今日任务：due 语块 12 个；本轮建议复现 top-3：[tomar en serio, darse cuenta, a lo mejor]
  ├─ 最近错误类别 top3（7 天聚合）：第三人称 -s 遗漏 ×6；ser/estar ×4；过去时词尾 ×3
  └─ 互动信号摘要：上轮查词 3 次；平均回复延迟 9s（高于基线 2×）；请求重复 1 次

L2 按需层（工具调用，不进默认上下文）
  SQL/工具接口：per-chunk FSRS 明细、某语法点 PFA 历史、用户词典……
  LLM 在需要时（如用户问"我哪里最差"）自行查询
```

历史对话只保留最近 k 轮原文 + 滚动一句摘要；完整历史永远只在 SQLite。

### 5.3 角色关系记忆的最小化

| 必须记 | 可以不记 |
|---|---|
| 用户身份锚点（名字、职业、兴趣、语言目标） | 逐字对话历史（可再检索，不默认注入） |
| 共同经历事件（一条一句+时间戳，如"上周一起聊了面试"） | 一次性问答与客套 |
| 角色↔用户的约定与梗（人设连续性所必需） | 任何可由学习者状态重新推导的事实（"他学过 X"→ 查 SRS log，不要存两遍） |
| 用户显式要求记住的 | |

实现形态：curated facts 表 `(subject, predicate, object, ts, salience, source)` + 向量检索 top-k（≤10 条）注入 L1；写入由 LLM 在会话结束/话题切换时抽取（ADD/UPDATE/DELETE 语义，Mem0 模式）。全文历史仅存 SQLite 供检索。**成本对比证据**：Mem0 报告 curated 方案相对 full-context token −72%~90%、延迟 −91%（厂商相关论文，证据等级：工程基准，非独立复现——见附录）。

---

## 6. 产品先例：学习状态都是独立系统

| 产品 | 做法 | 关键证据 |
|---|---|---|
| **Duolingo（学习核心）** | HLR 半衰期回归（[Settles & Meeder 2016, ACL, DOI: 10.18653/v1/P16-1174](https://aclanthology.org/P16-1174/)，13M 学习记录训练）→ **Birdbrain**（[官方博客 2020](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/)）：独立 ML 系统，同时估计"用户会多少"和"练习有多难"，预测作答正确率喂给 Session Generator；A/B 测试显示学习与留存双升；2020 年 10 月已个性化 >20% 课程。另有词级追踪系统与 Birdbrain 互补 | 官方论文 + 官方博客 + SLAM 共享任务（2018）。**学习状态从头到尾是独立 ML/数据库系统，从未依赖生成模型记忆** |
| **Duolingo（LLM 部分）** | Max 层的 Video Call（角色 Lily）与 Roleplay 是 LLM 驱动，但**坐在 lesson tree 之外**：Video Call 用结构化四段弧（开场→首问→自由交流→收尾），课程编排仍归 Birdbrain | 二手分析（[Flagrare/llm-tutor 研究笔记](https://github.com/Flagrare/llm-tutor/blob/main/docs/research/02-llm-tutor-landscape-2026.md)、媒体评测），Duolingo 官方未公开 Max 内部架构细节——见附录 |
| **Duolingo English Test** | 生产级 CAT：IRT 标定题库 + 自适应选题，[技术手册 2019](https://s3.amazonaws.com/duolingo-papers/other/Duolingo English Test - Technical Manual 2019.pdf)；[BERT-IRT 解决新题冷启动](https://aclanthology.org/2024.bea-1.35.pdf)；[AutoIRT（arXiv:2409.08823）](https://arxiv.org/abs/2409.08823) | 官方研究报告系列。证明 IRT/CAT 工程可行且活跃演进 |
| **LingQ** | 每词状态机 1(New)→2(Recognized)→3(Familiar)→4(Learned)/Known/Ignored，由查词与复习驱动；known words 计数是核心水平指标（[官方支持文档](https://lingq-support.groovehq.com/help/can-you-explain-a-lingqs-status)、[官方博客](https://www.lingq.com/blog/spanish-vocabulary/)） | 状态存在数据库，不进任何模型上下文；证明"查词驱动的词汇状态"是成熟产品模式 |
| **Dreaming Spanish** | 唯一状态 = 可理解输入累计小时（分难度），roadmap 7 级（50/150/300/600/1000/1500h）粗对齐 CEFR（[官网](https://www.dreamingspanish.com/)；里程碑数值见二手整理 [Copycat Cafe 2026](https://copycatcafe.com/blog/dreaming-spanish-review)、[LingoKeep 2026](https://lingokeep.com/blog/dreaming-spanish-roadmap)） | 证明**极低维状态**（一个标量）也能驱动大规模用户的内容分级决策 |
| **Anki/FSRS 生态** | per-card D/S/R 状态 + 本地数据库；FSRS 官方基准（FSRS-Anki-20k 数据集）上预测精度优于 SM-2/HLR（项目方基准，[Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki)） | 与用户已定的 ts-fsrs 一致 |

**共同模式**：状态 = 结构化数据库 + 小模型；LLM/生成模型只出现在交互表面。用户的假设正是这些产品架构的复述。

---

## 7. 参考文献汇总

**知识追踪与学习者建模**
1. Corbett, A. T., & Anderson, J. R. (1995). Knowledge tracing: Modeling the acquisition of procedural knowledge. *User Modeling and User-Adapted Interaction*, 4(4), 253–278. [DOI: 10.1007/BF01099821](https://link.springer.com/article/10.1007/BF01099821) — 共识：教科书级
2. Pavlik, P. I., Cen, H., & Koedinger, K. R. (2009). Performance Factors Analysis—A New Alternative to Knowledge Tracing. *AIED 2009*, 531–538. [ERIC ED506305](https://eric.ed.gov/?id=ED506305) — 共识：教科书级
3. Piech, C., et al. (2015). Deep Knowledge Tracing. *NeurIPS 28*. [官方页](https://proceedings.neurips.cc/paper/2015/hash/bac9162b47c56fc8a4d2a519803d51b3-Abstract.html) — 共识：教科书级（作为基线）
4. Khajah, M., Lindsey, R. V., & Mozer, M. C. (2016). How Deep is Knowledge Tracing? *EDM 2016*. [arXiv:1604.02416](https://arxiv.org/abs/1604.02416) — 共识：高（多次被复现确认）
5. Gervet, T., Koedinger, K., Schneider, J., & Mitchell, T. (2020). When is Deep Learning the Best Approach to Knowledge Tracing? *JEDM*, 12(3), 31–54. [JEDM](https://jedm.educationaldatamining.org/index.php/JEDM) — 共识：高
6. Yeung, C.-K., & Yeung, D.-Y. (2018). Addressing Two Problems in Deep Knowledge Tracing via Prediction-Consistent Regularization. *L@S 2018*. [DOI: 10.1145/3231644.3231647](https://dl.acm.org/doi/10.1145/3231644.3231647) — 共识：高
7. Sarsa, S., Leinonen, J., & Hellas, A. (2022). Empirical Evaluation of Deep Learning Models for Knowledge Tracing. *JEDM*, 14(2). [DOI: 10.5281/zenodo.7086179](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/553) — 共识：高（复制研究）
8. Pelánek, R. (2017). Bayesian Knowledge Tracing, Logistic Models, and Beyond: An Overview of Learner Modeling Techniques. *UMUAI*, 27, 313–350. [DOI: 10.1007/s11257-017-9193-2](https://link.springer.com/article/10.1007/s11257-017-9193-2) — 权威综述
9. *Faster, Cheaper, More Accurate: Specialised Knowledge Tracing Models Outperform LLMs* (2026). [arXiv:2603.02830](https://arxiv.org/html/2603.02830v1) — 共识：新（单篇，未复制；但与方向证据一致）

**间隔重复与遗忘**
10. Settles, B., & Meeder, B. (2016). A Trainable Spaced Repetition Model for Language Learning (HLR). *ACL 2016*, 1848–1858. [DOI: 10.18653/v1/P16-1174](https://aclanthology.org/P16-1174/)
11. Ye, J., Su, J., & Cao, Y. (2022). A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling. *KDD 2022*, 4381–4390. [DOI: 10.1145/3534678.3539081](https://dl.acm.org/doi/10.1145/3534678.3539081)
12. Su, J., Ye, J., Nie, L., Cao, Y., & Chen, Y. (2023). Optimizing Spaced Repetition Schedule by Capturing the Dynamics of Memory. *IEEE TKDE*, 35(10), 10085–10097. [DOI: 10.1109/TKDE.2023.3251721](https://ieeexplore.ieee.org/document/10059206)
13. Ridgeway, K., Mozer, M. C., & Bowles, A. R. (2017). Forgetting of Foreign-Language Skills. *Cognitive Science*, 41(4), 924–949. [DOI: 10.1111/cogs.12385](https://onlinelibrary.wiley.com/doi/10.1111/cogs.12385)
14. FSRS 官方 Wiki 与基准。[GitHub Wiki](https://github.com/open-spaced-repetition/fsrs4anki/wiki) — 项目方材料

**二语习得建模 / 词汇 / 测量**
15. Settles, B., Brust, C., Gustafson, E., Hagiwara, M., & Madnani, N. (2018). Second Language Acquisition Modeling (SLAM). *BEA 2018*, 56–65. [DOI: 10.18653/v1/W18-0506](https://aclanthology.org/W18-0506/) / [PDF](https://research.duolingo.com/papers/settles.slam18.pdf)
16. Nation, I. S. P. (2013). *Learning Vocabulary in Another Language* (2nd ed.). Cambridge UP. [DOI: 10.1017/CBO9781139858656](https://doi.org/10.1017/CBO9781139858656)
17. Nation, I. S. P., & Beglar, D. (2007). A vocabulary size test. *The Language Teacher*, 31(7), 9–13.
18. Beglar, D. (2010). A Rasch-based validation of the Vocabulary Size Test. *Language Testing*, 27(1), 101–118. [DOI: 10.1177/0265532209340194](https://doi.org/10.1177/0265532209340194)
19. Zhong, H. (2018). The Relationship between Receptive and Productive Vocabulary Knowledge. [ERIC EJ1186015](https://eric.ed.gov/?id=EJ1186015)
20. Klein-Braley, C., & Raatz, U. (1984). C-test 原始文献（转引自 [Georgetown AELRC 研究简报](https://aelrc.georgetown.edu/resources/research-briefs/c-test-research-brief/)）
21. Eckes, T., & Grotjahn, R. (2006). A closer look at the construct validity of C-tests. *Language Testing*, 23(3), 290–325. [DOI: 10.1191/0265532206lt330oa](https://journals.sagepub.com/doi/10.1191/0265532206lt330oa)
22. Vajjala, S., & Rama, T. (2018). Experiments with Universal CEFR Classification. *BEA 2018*, 147–153. [DOI: 10.18653/v1/W18-0515](https://aclanthology.org/W18-0515/)
23. Laufer, B., & Hill, M. (2000). What Lexical Information Do L2 Learners Select in a CALL Dictionary and How Does It Affect Word Retention? *LLT*, 3(2), 58–76. [ERIC ED462834](https://eric.ed.gov/?id=ED462834)
24. Godfroid, A., Boers, F., & Housen, A. (2013). An Eye for Words. *SSLA*, 35(3), 483–517. [ERIC EJ1018135](https://eric.ed.gov/?id=EJ1018135)
25. Long, M. H. (1996). The role of the linguistic environment in second language acquisition. *Handbook of Second Language Acquisition*. 综述见 [Loewen (2018), *Language Teaching*](https://www.cambridge.org/core/journals/language-teaching/article/78A156EE200F744F5978F99BFB073DBE)
26. Roediger, H. L., & Karpicke, J. D. (2006). Test-Enhanced Learning. *Psychological Science*, 17(3), 249–255. [DOI: 10.1111/j.1467-9280.2006.01693.x](https://pubmed.ncbi.nlm.nih.gov/16507066/)
27. Adesope, O. O., Trevisan, D. A., & Sundararajan, N. (2017). Rethinking the Use of Tests: A Meta-Analysis of Practice Testing. *RER*, 87(3), 659–701. [DOI: 10.3102/0034654316689306](https://doi.org/10.3102/0034654316689306)

**ITS 架构与自适应测试**
28. Woolf, B. P. (2009). *Building Intelligent Interactive Tutors*. Morgan Kaufmann.（四模块架构表述转引自 [Springer 开放论文](https://link.springer.com/content/pdf/10.1007/s40593-021-00266-y.pdf)）
29. Nkambou, R., et al. (Eds.) (2010). *Advances in Intelligent Tutoring Systems*. Springer.（四模块表述见 [BEA 2023 转引](https://aclanthology.org/2023.bea-1.2.pdf)）
30. VanLehn, K. (2011). The Relative Effectiveness of Human Tutoring, Intelligent Tutoring Systems, and Other Tutoring Systems. *Educational Psychologist*, 46(4), 197–221. [DOI: 10.1080/00461520.2011.611369](https://doi.org/10.1080/00461520.2011.611369)
31. Duolingo English Test Technical Manual (2019). [PDF](https://s3.amazonaws.com/duolingo-papers/other/Duolingo English Test - Technical Manual 2019.pdf)
32. Yancey, K. P., et al. (2024). Accelerating Item Piloting with BERT Embeddings and Explanatory IRT (BERT-IRT). *BEA 2024*. [PDF](https://aclanthology.org/2024.bea-1.35.pdf)
33. Sharpnack, J., et al. (2024). AutoIRT. [arXiv:2409.08823](https://arxiv.org/abs/2409.08823)

**LLM 上下文与记忆工程**
34. Liu, N. F., et al. (2023/2024). Lost in the Middle. *TACL*, 12. [DOI: 10.1162/tacl_a_00638](https://arxiv.org/abs/2307.03172) — 共识：高
35. Levy, M., Jacoby, A., & Goldberg, Y. (2024). Same Task, More Tokens. *ACL 2024*. [ACL Anthology 2024.acl-long.818](https://aclanthology.org/2024.acl-long.818/) — 共识：中高
36. Chhikara, P., et al. (2025). Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory. *ECAI 2025*. [arXiv:2504.19413](https://arxiv.org/abs/2504.19413) — 共识：工程基准（厂商相关，未经独立复现）

**产品官方来源**
37. Duolingo Blog (2020). Learning how to help you learn: Introducing Birdbrain! [URL](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/)
38. LingQ Support. How does the status of my LingQs work? [URL](https://lingq-support.groovehq.com/help/can-you-explain-a-lingqs-status)
39. Dreaming Spanish 官网与方法页。 [URL](https://www.dreamingspanish.com/)（里程碑数值经二手来源交叉确认）

---

## 8. 附录：不确定项与未能证实的点

1. **单用户场景下 PFA/BKT 的参数可靠性**：KT 文献的拟合几乎都假设跨用户合并数据；本产品是单用户本地场景，参数估计的收敛性与最优做法（如固定部分参数、贝叶斯先验）**没有直接文献**，需要自己以模拟数据验证。
2. **语块作为 KC 的粒度**：KT 模型依赖"知识成分"划分；以语块为单位时，一个语块应算一个 KC 还是映射到语法点/词位多个 KC，无实证标准。建议保守起步：chunk_id 本身为 KC，语法点作为可选第二维度。
3. **角色"装不懂"请求澄清作为校准手段**：互动假说支持它对**习得**有益，但未找到把它用作**测量信号**（探测用户能否重述）的效度研究。属于"理论合理、自行验证"。
4. **LLM 判分器在目标语言上的准确率**：SLAM 证明错误可预测，但那是统计模型；用当代 LLM 逐轮判定"语块产出是否正确"的公开基准（尤其非英语）未找到。上线前应自测：抽样人工标注 vs LLM 判定的一致率。
5. **Mem0 的成本数字**（token −72%~90%、延迟 −91%）来自厂商关联论文（arXiv:2504.19413），基准为 LOCOMO 长对话，与"语言学习角色"的分布有差异；方向可信，数值不可直接搬用。
6. **Duolingo Max / Video Call 内部架构**（LLM 如何与 Birdbrain 分工、四段弧设计）来自二手分析（GitHub 研究笔记、媒体评测），Duolingo 官方未披露细节；只作模式参考，不作证据。
7. **词汇量测试的猜测膨胀**：VST 类选择题在无惩罚时系统性高估（Beglar 2010 后的 Rasch 争论）；作为相对追踪指标无碍，作为绝对水平宣称需谨慎。
8. **自我修正行为的自动量化**：SLA 理论支持其价值，但未找到"自动检测自我修正并用于状态更新"的实证工作。
9. **输入时长→CEFR 的映射**：Dreaming Spanish 的小时数-级别对照是产品经验值（基于 Krashen 输入假说），未经心理测量学标定；只能作为粗粒度内容分级依据。
