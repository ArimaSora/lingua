# 二语文本难度自动评估：给 Lingua 的「推送 / 解锁队列」决策选型

> 研究日期：2026-10-03
> 背景：Lingua（TypeScript、本地优先、SQLite、可调用 DeepSeek/Qwen-flash 级 LLM API）需要对 RSS 文章与用户粘贴文本自动评估难度，服务对象是从零开始（A1）的学习者，输出决策为「直接推送 / 进解锁队列（标注"约 B1 解锁"）」。未来扩展日语（JLPT 体系）。项目约束见 ADR-0007（MVP 范围）与 ADR-0011（多语言架构）。
> 方法：结论尽量回溯到一手来源（论文 DOI/ACL Anthology/arXiv、官方文档、GitHub 仓库许可）；每条标注证据强度与共识等级；未证实的点在附录明确列出。

---

## 1. TL;DR（推荐方案）

**推荐：以「CEFR 分级词表的词汇覆盖率」为主信号起步（纯本地、零成本、几十行代码），叠加一句句长统计做辅助约束；LLM 评级作为廉价的第二信号/仲裁（每篇成本 < ¥0.01），不要作为唯一信号。不做 CEFR 分类器自训练，不做完整语言复杂度工具链。**

理由一句话版：

1. **词汇覆盖→阅读理解的关系是整个二语习得领域最稳的实证结论之一**，且近年的高质量复制研究（Schmitt et al. 2011 线性关系；Kremmel et al. 2023 复制 Hu & Nation）把「98% 硬阈值」修正为**连续关系**——这正好匹配本项目「渐进解锁队列」的设计，而不是一个二值门槛。[Schmitt et al. 2011, DOI: 10.1111/j.1540-4781.2011.01146.x](https://www.lextutor.ca/cover/papers/schmitt_etal_2011.pdf)；[Kremmel et al. 2023, DOI: 10.1111/lang.12622](https://www.research.lancs.ac.uk/portal/en/publications/unknown-vocabulary-density-and-reading-comprehension(1c253fdb-04d2-4185-8ef9-0771a30f133d)/export.html)
2. **传统可读性公式（FK/ARI 等）为母语者设计，对二语者效度弱**（只看句长+词长，不看词频/学习者），有专门的 L2 改良版（CML2RI），但公式类整体已被特征化 ML 与 LLM 方法超越。共识：中高。[Crossley et al. 2008, TESOL Quarterly 42(3)](https://eric.ed.gov/?id=EJ818264)
3. **LLM 直接打 CEFR 等级：连续难度打分与人类判断相关高，但绝对 6 级分类准确率平庸**（GPT-4o 句级 6 分类准确率约 64%），**打不过专用小模型**（同任务 87%），更打不过词表法在「这篇对 A1 能不能读」这个具体决策上的可解释性。LLM 的价值在于：便宜（每篇 <¥0.01）、能处理词表覆盖不到的语义（专名、话题、语域）、以及**改写降级**（Duolingo 的产品先例是"分类+改写"双件套）。[Reading.help, CHI 2026, arXiv:2505.14031](https://arxiv.org/html/2505.14031v2)；[Trott & Rivière 2024, TSAR, DOI: 10.18653/v1/2024.tsar-1.13](https://aclanthology.org/2024.tsar-1.13/)；[Grossman & Chen 2026, arXiv:2604.24470](https://arxiv.org/html/2604.24470v1)
4. **对 A1 用户的现实**：真实 RSS 内容几乎全在 B1+，队列会吞掉绝大多数推送——所以难度评估要立刻和两条出路配套：① Bootstrap 课包/分级读物源（ADR-0011 已定）；② LLM 降级改写（见 §6.4）。
5. 一旦用户的已知词表在 SQLite 里积累起来，**个性化覆盖率（LingQ 的 "% new words" 模式）是比任何静态分级更强的信号**，应作为第二阶段升级。

---

## 2. 方法对比表

| 方法 | 核心做法 | 证据与效果 | 实现成本（TS 本地） | 可用工具/数据与许可 |
|---|---|---|---|---|
| **传统可读性公式**（Flesch-Kincaid、ARI、SMOG 等） | 句长 + 词长/音节数的线性回归，输出美国年级 | 为 L1 学生文本标定；对 L2 读者构念效度弱（EFL 场景与 cloze 相关但效应小）；Crossley 2008 证明含词频/衔接特征的 CML2RI 显著更优。共识：中高 | 极低（音节计数是启发式，JS 有近似实现） | 公式公开；Python textstat（MIT）可参考实现 |
| **L2 专用公式 CML2RI** | 词频（CELEX）+ 句间句法相似度 + 实词重叠，回归自 L2 cloze 成绩 | 拟合 L2 阅读理解，优于 FK 类；但依赖 Coh-Metrix 计算指标。共识：中（单团队系列研究，被广泛引用） | 中（需词频表 + 解析；Coh-Metrix 本体是封闭 Web 工具） | Coh-Metrix：免费 Web 账号（研究用途），不可嵌入本地管道 |
| **词汇覆盖/词表画像**（Nation RANGE 谱系） | 用词频带（1k/2k/…）或 CEFR 分级词表统计各级覆盖率 | 覆盖→理解：Laufer 1989（95% 阈值）；Hu & Nation 2000（98%）；Schmitt 2011（661 人 8 国，线性关系 r≈.41，无硬阈值）；Kremmel 2023 复制（104 斯里兰卡学习者，5 档密度，原结论不能完全复制——支持连续而非阈值）。**共识：强** | 低：分词 + 词形还原 + 词表查表 | RANGE/AntWordProfiler：免费软件（非开源，桌面工具，不适合嵌管道）；词表数据见 §3.2 |
| **CEFR 词表覆盖**（EVP/EFLLex/CEFR-J 变体） | 同上，但词表带 CEFR 等级标签 → 直接输出「≤A1 占比」「首个达到 95% 覆盖的级别」 | Duolingo CEFR Checker、CVLA 两个独立先例（见 §5）；Reading.help 用词表+特征训练词级模型。共识：强（工程层面） | 低 | EFLLex（CC BY-NC-SA 4.0）；CEFR-J wordlist（免费下载）；EVP（在线免费、批量受限）；Octanove VP C1/C2（开放） |
| **监督式 CEFR 文本分级器** | 在 CEFR 标注语料上微调 BERT 类模型 | 文档级 3 分类（OneStopEnglish）SOTA ≈ 79%（155 特征 SVM 78.13%；HAN 78.95%）；句级 6 分类（CEFR-SP）专用模型约 87%。共识：高（有公开基准） | 高（需 Python 推理环境或 ONNX 运行时；训练需 GPU+语料） | 语料：OneStopEnglish（CC BY-SA 4.0）、CEFR-SP（无显式许可、引用要求）、UniversalCEFR（50 万条 13 语，逐子语料许可）；模型：dksysd/cefr-classifier（CC BY-NC-SA 4.0，无公开评测）等，多为玩具级 |
| **语言学术复杂度工具**（Coh-Metrix、L2SCA、LingFeat） | 数十至数百个句法/词汇/衔接特征 | 特征有效性有大量文献；但工具为研究场景设计（桌面/命令行/Python），且 L2SCA 类指标本为**学习者产出**标定而非**文本难度**。共识：特征有效=高；直接用现成工具嵌管道=不合适 | 中-高 | LingFeat（Python，CC BY-SA 4.0，255 特征）；L2SCA（PSU 免费下载）；NeoSCA（GPL-3.0 fork）；CTAP（开源，Java）；均非 TS 原生 |
| **LLM 直接评级** | Prompt 输出 CEFR 等级或连续难度分 | 连续打分：GPT-4 零样本与人类判断高相关（Trott & Rivière 2024，CLEAR 语料 4724 段）；10 个开源 LLM × 14 数据集系统评测：提示法影响大，LLM+公式混合（LAURAE）最稳（Grossman & Chen 2026）。**绝对 6 级分类：GPT-4o 句级 64.0%、词级 52.9%，均输专用小模型**（Reading.help）。作文 CEFR 评分 few-shot 可接近专用 AWE 系统（Yancey et al. 2023，文本体裁=作文而非待读文本）。共识：中（方向一致，绝对精度数字为单篇） | 极低（一次 API 调用，每篇 <¥0.01） | 任何指令模型；DeepSeek-flash ≈ $0.15–0.30/M 输入 tokens；Qwen-Flash ≈ $0.113/M 输入 |

**对「A1 推送/排队」这个具体决策的适配性排序**：CEFR 词表覆盖 > LLM 评级 > 句长类公式 ≫ 自训练分类器 > 完整复杂度工具链。

---

## 3. 方法谱系细节

### 3.1 传统可读性公式对二语者是否适用

- FK/Flesch 类公式只用**平均句长**与**每词音节/字符数**两个表层特征，标定对象是美国母语学生的年级，输出的是「年级」而非学习者水平。[FK 公式说明](https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests)
- 对 L2 的批评与改良：Crossley, Greenfield & McNamara（2008, *TESOL Quarterly* 42(3): 475–493, [ERIC EJ818264](https://eric.ed.gov/?id=EJ818264)，被引 550+）指出传统公式"窄于表层特征、忽视读者的加工过程"，提出 **CML2RI**（Coh-Metrix L2 Reading Index）：CELEX 词频 + 相邻句句法相似度 + 实词重叠三特征，回归自 L2 cloze 成绩，效度显著优于 FK。EFL 语境下的构念验证研究进一步指出公式与 cloze 的相关效应量有限（["Validating the Construct of Readability in EFL Contexts", VLI 8(1), 2023](https://www.castledown.com/articles/VLI_8_1_v02.pdf)）。
- **结论**：公式只能当免费的辅助信号（句长本身有价值，见 §6），不能当 L2 难度量尺。Readlang 把 ARI 用于捷克语/乌克兰语等屈折语翻车的案例见 §5。

### 3.2 词汇覆盖/词表画像法（本项目的主信号）

**实证链**（均为高被引一手文献）：

1. Laufer (1989)：理解学术文本到"及格"水平（55% 分）约需 95% 覆盖。
2. Hu & Nation (2000, *Reading in a Foreign Language* 14(1)：虚构文本"充分理解"需 98% 覆盖（66 名新西兰大学生，回归外推）。
3. **Schmitt, Jiang & Grabe (2011, *Modern Language Journal* 95(1), [PDF@lextutor](https://www.lextutor.ca/cover/papers/schmitt_etal_2011.pdf)，被引 1400+)**：661 名 8 国学习者实测——覆盖率与理解呈**近似线性关系，不存在魔术阈值**；每多认识 1% 的词，理解分稳定增长；90% 覆盖时理解约五成，100% 时也远非满分。
4. **Kremmel, Indrarathne, Kormos & Suzuki (2023, *Language Learning* 73(4): 1127–1163, DOI: 10.1111/lang.12622)**：对 Hu & Nation 的直接复制（104 名斯里兰卡成人、80/90/95/98/100% 五档密度、叙事+说明文、选择+简答两种题型）——**原研究的 98% 阈值结论不能被完全复制**；文本体裁与题型都调节该关系。这正是调研问题里提到的"覆盖率-理解连续关系"：方向稳定，阈值不实。
5. 综述：Webb (2021, *Reading in a Foreign Language*, [ERIC EJ1316858](https://files.eric.ed.gov/fulltext/EJ1316858.pdf)) 汇总覆盖-理解文献，支持 95–98% 作为"多数学习者充分理解"的区间而非临界点。

**设计含义**：把覆盖率当作**连续预测变量**而非门槛——"约 B1 解锁"的语义 = "当你掌握 B1 级词汇时，本文覆盖率将达到 ~95%+"。这正好由分级词表自然产出（见 §6.2 的算法）。

**词表资源对比**：

| 资源 | 内容 | 许可 | 适合 |
|---|---|---|---|
| **EFLLex**（Dürlich & François 2018, LREC, [官网](https://cental.uclouvain.be/cefrlex/efllex/)） | 15,280 词元（lemma+POS），A1–C1 各级词频分布，源自教材/分级读物语料 | **CC BY-NC-SA 4.0**（非商用） | 主词表首选；注意无 C2 档、语料小导致覆盖有洞 |
| **CEFR-J Wordlist**（Tono, TUFS, [下载页](http://www.cefr-j.org/download.html)） | 面向东亚学习者教材语料的 CEFR 分级词表（v1.6）；另有语法表 | 官网免费下载（研究/教学用途；条款宽松但未标准化） | 备选/交叉验证；CVLA 与 PyCEFRizer 均基于它 |
| **EVP**（Cambridge English Vocabulary Profile, [englishprofile.org](https://englishprofile.org/)） | 最权威的人工标注 CEFR 词表（A1–C2） | **在线查询免费；批量数据需申请，不可直接进产品管道** | 只做参照，不做数据源 |
| **Octanove Vocabulary Profile C1/C2**（[openlanguageprofiles/olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj)） | 补齐 C1/C2 档 | 开放仓库 | 补 EFLLex 的 C2 缺口 |
| **NGSL**（Browne, Culligan & Phillips, [官网](https://www.newgeneralservicelist.com/)） | 2809 高频词族（覆盖日常英语 ~92%） | **CC BY-SA 4.0** | 冷启动兜底："在 NGSL 内"≈ 基础可读的必要条件 |

**工具先例**：Nation 的 RANGE（[VUW 资源页](https://www.wgtn.ac.nz/lals/resources/paul-nations-resources)）与 Anthony 的 AntWordProfiler（[laurenceanthony.net](https://www.laurenceanthony.net/software/antwordprofiler/)）都是**免费桌面软件（非开源、非库）**——验证思路可用，嵌管道不可用；自己实现查表逻辑反而更简单。

### 3.3 CEFR 文本分级器与语料

**语料**：

| 语料 | 规模/粒度 | 许可 | 备注 |
|---|---|---|---|
| OneStopEnglish（Vajjala & Lučić 2018, BEA, [DOI: 10.18653/v1/W18-0535](https://aclanthology.org/W18-0535/)） | 189 篇卫报文章 × 3 档改写（ele/int/adv），文档级 | **CC BY-SA 4.0**（[GitHub](https://github.com/nishkalavallabhi/OneStopEnglishCorpus)） | 最常用文档级基准；SOTA 3 分类 ≈ 79%（[Martinc et al., arXiv:1907.11779](https://arxiv.org/pdf/1907.11779v2.pdf)） |
| CEFR-SP（Arase, Uchida & Kajiwara 2022, EMNLP, [DOI: 10.18653/v1/2022.emnlp-main.416](https://aclanthology.org/2022.emnlp-main.416/)） | 17k 英语句子 × 6 级，专家标注 | **无显式开源许可**，引用要求；公开子集剔除 Newsela 来源（约 10k） | 句级基准；[GitHub yudiwibisono/CEFR-SP](https://github.com/yudiwibisono/CEFR-SP) |
| UniversalCEFR（Imperial et al. 2025, [arXiv:2506.01419](https://arxiv.org/abs/2506.01419)） | **505,807 条、13 语言**、多粒度，统一格式 | 逐子语料各异（如英文 readme 子集 CC BY-SA-NC 4.0） | [HF org](https://huggingface.co/UniversalCEFR)；想用现成数据训练先查子集许可 |
| Cambridge English Readability Dataset（Xia et al. 2016, BEA） | 331 段剑桥考试阅读（A2–C2） | 需向作者/剑桥申请 | 考试文本，与 RSS 分布差距大 |
| Ace-CEFR（[arXiv:2506.14046](https://arxiv.org/abs/2506.14046)） | 英语**会话体**短文本 CEFR 标注 | 公开发布供研发（条款需逐项确认） | 体裁上最贴近"角色消息"，与本文场景（RSS）关系弱 |
| TSAR 2025 shared task 数据（British Council LearnEnglish 来源，[ACL 2025.tsar-1.8](https://aclanthology.org/2025.tsar-1.8.pdf)） | 文档级 CEFR 对齐 | 研究用途 | 教学网站文本 |

**模型**：HuggingFace 上的 CEFR 分类器多为个人作品、无严肃评测——dksysd/cefr-classifier（deberta-v3-large，CC BY-NC-SA 4.0，模型卡无准确率数字）；yanou16/cefr-english-classifier（Qwen2.5-1.5B + QLoRA，训练集为 1,785 条**合成数据**）；SNALYF/CEFR_Bert_Fine-tuned（回归）。**结论：没有"下载即可信"的开源 CEFR 分级器**；严肃的公开结果都伴随特定语料（上表），跨域泛化差是已知问题（[Vajjala 2022 综述, LREC, arXiv:2105.00973](https://arxiv.org/html/2105.00973v2)）。

### 3.4 语言学术复杂度工具

- **Coh-Metrix**（Memphis 大学）：100+ 衔接/句法/词汇指标，免费 Web 账号（研究用途），封闭、不可嵌入本地管道；其 L2 衍生公式 CML2RI 见 §3.1。
- **L2SCA**（Lu 2010, [PSU 主页](https://sites.psu.edu/xxl13/l2sca/)）：14 个句法复杂度指标，免费下载；开源维护 fork **NeoSCA**（Python，GPL-3.0，[GitHub tanloong/neosca](https://github.com/tanloong/neosca)）。**注意构念错配**：L2SCA 为测量"学习者写作产出的句法发展"标定，指标（T-unit 长度、从句比等）可作为文本难度特征借用，但其常模不适用于"文本对读者是否可读"。
- **LingFeat**（Lee, Jang & Lee 2021, EMNLP, [DOI: 10.18653/v1/2021.emnlp-main.834](https://aclanthology.org/2021.emnlp-main.834/)）：255 个手工特征（含传统公式、TTR、AoA、SUBTLEX 词频、短语结构等），Python，[GitHub brucewlee/lingfeat](https://github.com/brucewlee/lingfeat)，**CC BY-SA 4.0**（注意：代码用 CC 许可而非软件许可，ShareAlike 传染性需自行评估）。
- **本项目结论**：不值得为 A1 推送决策引入整套工具链；其中两个"便宜特征"——**平均句长**与**词频/覆盖率**——单独拿出来用即可（这恰是 CML2RI 与 CVLA 的共同核心）。

### 3.5 LLM 直接评级的实证

| 研究 | 设置 | 结果 | 来源 |
|---|---|---|---|
| Trott & Rivière 2024 | GPT-4 Turbo / GPT-4o mini 零样本，连续难度打分，CLEAR 语料（4,724 段） | 与人类判断高相关，优于传统公式 | [TSAR 2024, DOI: 10.18653/v1/2024.tsar-1.13](https://aclanthology.org/2024.tsar-1.13/) |
| Grossman & Chen 2026 | 10 个开源 LLM × 14 数据集（多语言、多长度），系统比较提示法 | 提示法影响显著；最佳提示法在 13/14 数据集超过既往方法；**LLM+可读性公式混合（LAURAE）最稳**；英语最佳为 Llama-70B；LLM 口头置信度与准确率正相关（高低置信四分位相关差 16.7 点）；**明确警告：评测基于相关性而非绝对等级准确率** | [arXiv:2604.24470](https://arxiv.org/html/2604.24470v1) |
| Reading.help（CHI 2026） | GPT-4o 零样本 6 级 CEFR 分类 vs 专用小模型 | 词级：GPT-4o 52.9% acc vs 专用 64.8%；**句级：GPT-4o 64.0% vs 专用 87.4%**；分组（A\*/B/C\*）准确率 GPT-4o 约 62–70% | [arXiv:2505.14031](https://arxiv.org/html/2505.14031v2) |
| Yancey et al. 2023 | GPT-4 few-shot 给 **L2 作文**打 CEFR | 接近当时的 SOTA 作文评分系统（注意：评的是学习者产出，不是待读文本） | [BEA 2023, DOI: 10.18653/v1/2023.bea-1.49](https://aclanthology.org/2023.bea-1.49/) |

**结论**：LLM 评级在"相对难易排序 + 粗粒度分档（A\*/B\*/C\* 三档）"上够用且极便宜；在"精确到单个 CEFR 等级"上不可靠（6 分类约六成准确率，误差通常 ±1 级）。**对"推送/排队"决策，用其粗粒度即可，并永远与覆盖率信号交叉验证。** 成本：DeepSeek-flash 约 $0.15–0.30 / M 输入 tokens（[官方定价页为准，变动频繁](https://api-docs.deepseek.com/quick_start/pricing)），Qwen-Flash 约 $0.113 / M 输入（[阿里云 Model Studio 定价](https://www.alibabacloud.com/help/en/model-studio/model-pricing)）——一篇 800 词文章 ≈ 1.5k tokens，单次评级成本 < ¥0.01，可忽略。

---

## 4. 产品先例

| 产品 | 做法 | 来源与备注 |
|---|---|---|
| **Duolingo（CEFR Checker）** | 为每种语言构建**词级 CEFR 标签器**（从词表种子 + 词频/语义建模扩展，而非直译英语词表——"I am hungry / tengo hambre" 是 A1，但逐字对应的 hambriento 是 B1），用于 Stories/Podcast 等内容的**难度对齐与改写**；曾有公开演示 cefr.duolingo.com | [官方博客（2019，原文已迁移/部分失效）](https://blog.duolingo.com/the-duolingo-cefr-checker-an-ai-tool-for-adapting-learning-content/)；[UCLouvain 讲座摘要（McDowell 2021）](https://www.uclouvain.be/fr/instituts-recherche/ilc/plin/invited-talks)。**关键启发：Duolingo 不只"分类"，分类器是为"改写降级"服务的** |
| **LingQ** | 课程分 6 档（Beginner 1 – Advanced 2，官方未公布分档算法）；每课对用户展示**个性化 "% new words"**（该用户未知词占比），社区经验值 10–20% 为甜区 | [官方支持：级别设置](https://lingq-support.groovehq.com/help/how-to-set-and-change-your-level)；[官方论坛讨论](https://forum.lingq.com/t/metrics-for-gauging-the-difficulty-of-a-lesson/320643)。**个性化覆盖率的成熟产品先例** |
| **Readlang** | 创始人公开说明：难度 = **ARI + 词在"top-2000 词频表"中的占比**（词表多基于字幕语料）；创始人自述"far from perfect"，屈折语（乌克兰语 A1 文本被标成 C1–C2）因词表未做词形还原而翻车 | [Readlang 官方论坛，Steve Ridout 本人回答（2024-06）](https://forum.readlang.com/t/how-does-readlang-know-the-difficulty-of-a-text/37)。**反面教材：裸词表 + 不还原 = 不可信；以及 ARI 跨语言系数不适配** |
| **CVLA**（Uchida & Negishi） | 免费 Web 工具：CEFR-J 词表给词定级 + 4 个文本特征（ARI、每句动词数、平均词难度、B 级以上词占比）估计文本 CEFR | [cvla.langedu.jp/ver2](https://cvla.langedu.jp/ver2/)；[Uchida & Negishi 2018, APCLC](https://cvla.langedu.jp/ver2/APCLC2018_UchidaNegishi_web.pdf)。**与推荐方案同构的学术先例** |
| **PyCEFRizer** | 开源实现：CEFR-J 词表 + 8 个语言指标 → 文本 CEFR 估计 | [GitHub straygizmo/PyCEFRizer](https://github.com/straygizmo/PyCEFRizer)（Python，可作为特征选择参考） |
| **Newsdle 等分级新闻** | 人工/半人工把新闻重写成 CEFR 分级版本 | [官网](https://www.newsdle.com/blog/french-learning-apps)。印证"A1 能读的真实内容几乎只能靠改写" |

---

## 5. 推荐管道设计（落地到 TS + SQLite）

### 5.1 三级信号架构

```
文章入库（RSS / 粘贴）
   │
   ├─ L1 词汇画像（本地，~ms，零成本）────────── 主信号
   │    分句/分词 → 词形还原 → 查 EFLLex(+NGSL 兜底)
   │    产出：各级累计覆盖率 cov(≤A1..≤C1)、off-list 占比、
   │           未知词密度/百词、平均句长、最长句
   │
   ├─ L2 规则决策（本地）──────────────────────── 决策
   │    A1 直推：cov(≤A1) ≥ 95%（专名豁免）且 平均句长 ≤ ~12 词
   │    否则入队，解锁级 = 使累计覆盖率达 95% 的最低级别
   │
   └─ L3 LLM 粗评（API，<¥0.01/篇）──────────── 交叉验证 + 语义豁免
        输出：三档（A / B / C）+ 置信度 + 专名/话题说明
        与 L1 冲突时：标记 human/规则复核；专名主导型文章修正覆盖率
```

### 5.2 L1 具体实现要点

- **分词/句切分**：TS 生态即可（如 `compromise` 或自写正则 + 缩写表），不需要 spaCy 级精度——查表法的误差主要来自词形还原而非分词。
- **词形还原**：EFLLex 以 lemma+POS 存储；最小可行方案是**规则还原**（复数/时态/比较级后缀剥离 + 不规则变化表，`wink-lemmatizer` 类 JS 库即可），不做 POS 时取该 lemma 的最低级别档（偏宽松，对 A1 决策更安全的一侧是"把不认识当难"，见下）。Readlang 翻车的根因就是跳过这一步。
- **覆盖率计算**：按 token（非 type）计；专名、数字、URL 单列豁免类（Duolingo 与 RANGE 惯例均如此）；off-list 词（不在任何词表）默认计入"最难档"。
- **95% 的工作口径**：Schmitt 2011/Kremmel 2023 的连续关系意味着阈值是产品参数而非科学常数；对"直推"建议 95%（对应"基本可理解"），对"预计可独立流畅阅读"可用 98% 标注。**把阈值做成配置项，用用户实际阅读行为（查词率、放弃率）回头校准**——这是 LingQ 模式。
- **第二阶段升级（数据积累后）**：把"≤A1 词表"换成"该用户已知词集合"（来自 FSRS/查词行为），覆盖率即个性化——此时解锁标注也变成"预计掌握 X 词后解锁"。

### 5.3 为什么不做的三件事

1. **不自训 CEFR 分类器**：无现成可信开源模型；文档级 SOTA 也才 ~79%（3 分类）；为"±1 级容忍"的排队决策训练模型是负 ROI。若未来想要，路线是 UniversalCEFR 数据 + ONNX 运行时，而非自研。
2. **不接 Coh-Metrix/LingFeat 全家桶**：特征有效 ≠ 工具可嵌入；需要的两个核心特征（词频/覆盖、句长）已在 L1。
3. **不让 LLM 单独定级**：§3.5 的准确率数字不支持；且词表法给出的是**可解释的解锁条件**（"学会这些词即可读"），这正好衔接项目的语块预学闭环——LLM 的一个等级标签做不到这一点。

### 5.4 与产品闭环的衔接（关键洞察）

- **解锁队列标注的实质是"覆盖率预测"**：`unlock_level = argmin_L { cov(≤L) ≥ 95% }`，并可进一步给出"距解锁还需学 N 个语块"（把 off-target 词映射到语块库）。这比"约 B1 解锁"的静态标签更有行动性。
- **A1 的现实是队列吞掉一切**：真实 RSS 几乎全是 B1+。两条出路均有先例：Bootstrap 课包/分级源（ADR-0011 已定）；**LLM 降级改写**（Duolingo Stories 模式；TSAR 2024/2025 连续两年的 shared task 证明"控制 CEFR 级别的改写"是活跃且可行的技术方向，[TSAR 2025](https://aclanthology.org/2025.tsar-1.8.pdf)）。难度评估管道同时是改写质量的验收器。

---

## 6. 日语前瞻（JLPT 体系）

| 事项 | 现状 | 来源 |
|---|---|---|
| 官方词表 | **JLPT 自 2010 年起不公布官方词表/语法表**；一切"JLPT 词表"均为第三方推断 | [PACLIC 2017 论文脚注确认](https://ufal.mff.cuni.cz/pdt-c/publications/synkova-2017.pdf) |
| 社区标准词表 | **Jonathan Waller 的 JLPT 词表（CC BY）**——jisho.org 的 JLPT 标签即来源于此；stephenmk/yomitan-jlpt-vocab 将其对齐到 JMdict 词条 ID（解决同形/读音歧义） | [GitHub stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab)；[jisho 论坛说明](https://jisho.org/forum/585d0b6ad5dda733b0000001-jlpt-n1-only) |
| 可读性工具 | **jReadability**（Lee & Hasebe，基于分级教材语料的 6 级日语可读性模型，Web 工具 [jreadability.net](https://jreadability.net/)；论文 [Hasebe & Lee 2015, CASTEL-J](https://jreadability.net/file/hasebe-lee-2015-castelj.pdf)）；**Python 移植 [joshdavham/jreadability（MIT）](https://github.com/joshdavham/jreadability)** | 注意其等级是自有 6 级（教材分级语料标定），非 JLPT 官方对齐 |
| 分词前提 | 日语无空格，任何词表法先过分词：TS 管道用 **kuromoji.js（Apache-2.0）**；Sudachi 系更准但需 Node 绑定或 Python sidecar | kuromoji.js 仓库 |
| 架构复用 | 推荐管道的三层结构原样适用：L1 = kuromoji 分词 → Waller 词表覆盖率；L3 = 同一 LLM 粗评（多语 LLM 对 JLPT 描述子零样本即可，DeepSeek/Qwen 日文能力强于一般开源模型） | 推论，无独立实证 |

**风险**：JLPT 词表的"等级"本身是社区推断（非官方），且 N 级与"文本可读性"之间没有像 CEFR 词表那样的覆盖率实证链；初期建议直接用 jReadability 分数做相对排序 + 词表覆盖做解释，不要向用户承诺"官方 N 级"。

---

## 7. 参考文献

**覆盖率与理解（核心实证链）**
1. Laufer, B. (1989). What percentage of text-lexis is essential for comprehension? In *Special Language: From Humans Thinking to Thinking Machines*. Multilingual Matters. — 95% 阈值原始文献（转引自 [Oxford Academic 综述](https://academic.oup.com/applij/advance-article/doi/10.1093/applin/amae062/7841943)）
2. Hu, M., & Nation, I. S. P. (2000). Unknown vocabulary density and reading comprehension. *Reading in a Foreign Language*, 14(1), 69–107. — 98% 阈值原始文献
3. Schmitt, N., Jiang, X., & Grabe, W. (2011). The percentage of words known in a text and reading comprehension. *Modern Language Journal*, 95(1), 26–43. [DOI: 10.1111/j.1540-4781.2011.01146.x](https://www.lextutor.ca/cover/papers/schmitt_etal_2011.pdf) — 共识：强（线性关系，661 人 8 国）
4. Kremmel, B., Indrarathne, B., Kormos, J., & Suzuki, S. (2023). Unknown vocabulary density and reading comprehension: Replicating Hu and Nation (2000). *Language Learning*, 73(4), 1127–1163. [DOI: 10.1111/lang.12622](https://onlinelibrary.wiley.com/doi/10.1111/lang.12622) — 复制研究，98% 硬阈值不成立，支持连续关系
5. Webb, S. (2021). Research investigating lexical coverage and profiling: What we know, what we don't know, and what is needed. *Reading in a Foreign Language*. [ERIC EJ1316858](https://files.eric.ed.gov/fulltext/EJ1316858.pdf) — 综述
6. Nation, I. S. P. (2006). How large a vocabulary is needed for reading and listening? *Canadian Modern Language Review*, 63(1), 59–82. [DOI: 10.3138/cmlr.63.1.59](https://doi.org/10.3138/cmlr.63.1.59)

**可读性公式与 L2**
7. Crossley, S. A., Greenfield, J., & McNamara, D. S. (2008). Assessing text readability using cognitively based indices (CML2RI). *TESOL Quarterly*, 42(3), 475–493. [ERIC EJ818264](https://eric.ed.gov/?id=EJ818264) — 共识：中高
8. Castledown VLI 8(1) (2023). Validating the construct of readability in EFL contexts. [PDF](https://www.castledown.com/articles/VLI_8_1_v02.pdf)
9. Vajjala, S. (2022). Trends, limitations and open challenges in automatic readability assessment research. *LREC 2022*. [arXiv:2105.00973](https://arxiv.org/html/2105.00973v2) — 权威综述

**CEFR 语料与分级器**
10. Vajjala, S., & Lučić, I. (2018). OneStopEnglish corpus. *BEA 2018*. [DOI: 10.18653/v1/W18-0535](https://aclanthology.org/W18-0535/)；[GitHub（CC BY-SA 4.0）](https://github.com/nishkalavallabhi/OneStopEnglishCorpus)
11. Martinc, M., Pollak, S., & Robnik-Šikonja, M. (2021). Supervised and unsupervised neural approaches to text readability. *CL Journal*. [arXiv:1907.11779](https://arxiv.org/pdf/1907.11779v2.pdf) — OneStopEnglish SOTA 79%
12. Arase, Y., Uchida, S., & Kajiwara, T. (2022). CEFR-based sentence-difficulty annotation and assessment (CEFR-SP). *EMNLP 2022*. [DOI: 10.18653/v1/2022.emnlp-main.416](https://aclanthology.org/2022.emnlp-main.416/)；[GitHub](https://github.com/yudiwibisono/CEFR-SP)（无显式许可）
13. Imperial, J. M., et al. (2025). UniversalCEFR. [arXiv:2506.01419](https://arxiv.org/abs/2506.01419)；[HF](https://huggingface.co/UniversalCEFR)
14. Kogan, D., et al. (2025). Ace-CEFR (conversational texts). [arXiv:2506.14046](https://arxiv.org/abs/2506.14046)
15. Xia, M., Kochmar, E., & Briscoe, T. (2016). Text readability assessment for second language learners. *BEA 2016*. [arXiv:1606.03775](https://arxiv.org/abs/1606.03775)
16. Uchida, S., & Negishi, M. (2018). Assigning CEFR-J levels to English texts based on textual features (CVLA). *APCLC 2018*. [PDF](https://cvla.langedu.jp/ver2/APCLC2018_UchidaNegishi_web.pdf)；[工具](https://cvla.langedu.jp/ver2/)

**LLM 评级**
17. Trott, S., & Rivière, P. (2024). Measuring and modifying the readability of English texts with GPT-4. *TSAR 2024*. [DOI: 10.18653/v1/2024.tsar-1.13](https://aclanthology.org/2024.tsar-1.13/)
18. Grossman, R., & Chen, Y. (2026). Zero-shot large language models for automatic readability assessment (LAURAE). [arXiv:2604.24470](https://arxiv.org/html/2604.24470v1)
19. Shin, D., et al. (2026). Reading.help (GPT-4o vs 专用模型的 CEFR 分类对比). *CHI 2026*. [arXiv:2505.14031](https://arxiv.org/html/2505.14031v2)
20. Yancey, K. P., Laflair, G., Verardi, A., & Burstein, J. (2023). Rating short L2 essays on the CEFR scale with GPT-4. *BEA 2023*, 576–584. [DOI: 10.18653/v1/2023.bea-1.49](https://aclanthology.org/2023.bea-1.49/)

**工具与词表**
21. Dürlich, L., & François, T. (2018). EFLLex: A graded lexical resource for learners of English as a foreign language. *LREC 2018*. [官网](https://cental.uclouvain.be/cefrlex/efllex/)（CC BY-NC-SA 4.0）
22. Tono, Y. CEFR-J Wordlist. [cefr-j.org/download](http://www.cefr-j.org/download.html)
23. Browne, C., Culligan, B., & Phillips, J. New General Service List. [newgeneralservicelist.com](https://www.newgeneralservicelist.com/)（CC BY-SA 4.0）
24. Octanove Vocabulary Profile C1/C2. [GitHub openlanguageprofiles/olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj)
25. Lee, B. W., Jang, Y. S., & Lee, J. (2021). Pushing on text readability assessment: A transformer meets handcrafted linguistic features (LingFeat). *EMNLP 2021*. [DOI: 10.18653/v1/2021.emnlp-main.834](https://aclanthology.org/2021.emnlp-main.834/)；[GitHub（CC BY-SA 4.0）](https://github.com/brucewlee/lingfeat)
26. Lu, X. (2010). L2SCA. [PSU](https://sites.psu.edu/xxl13/l2sca/)；NeoSCA fork [GitHub（GPL-3.0）](https://github.com/tanloong/neosca)
27. Anthony, L. AntWordProfiler. [laurenceanthony.net](https://www.laurenceanthony.net/software/antwordprofiler/)（免费软件，非开源）；Nation & Heatley RANGE 见 [VUW 资源页](https://www.wgtn.ac.nz/lals/resources/paul-nations-resources)

**产品先例**
28. Duolingo Blog (2019). The Duolingo CEFR Checker: An AI tool for adapting learning content. [链接](https://blog.duolingo.com/the-duolingo-cefr-checker-an-ai-tool-for-adapting-learning-content/)（原文已迁移，内容经多方转引核对）；McDowell, B. (2021). The Duolingo CEFR Checker: A Multilingual Tool for Adapting Learning Content（[UCLouvain 讲座](https://www.uclouvain.be/fr/instituts-recherche/ilc/plin/invited-talks)）
29. Readlang 官方论坛 (2024). How does Readlang know the difficulty of a text? [链接](https://forum.readlang.com/t/how-does-readlang-know-the-difficulty-of-a-text/37)（创始人回答）
30. LingQ 支持文档. [How to set and change your level](https://lingq-support.groovehq.com/help/how-to-set-and-change-your-level)；[论坛：metrics for gauging difficulty](https://forum.lingq.com/t/metrics-for-gauging-the-difficulty-of-a-lesson/320643)
31. TSAR 2025 Shared Task（British Council LearnEnglish CEFR 数据）. [ACL Anthology 2025.tsar-1.8](https://aclanthology.org/2025.tsar-1.8.pdf)

**日语**
32. Hasebe, Y., & Lee, J. (2015). Introducing a readability evaluation system for Japanese language education (jReadability). *CASTEL-J*. [PDF](https://jreadability.net/file/hasebe-lee-2015-castelj.pdf)；Python 移植 [joshdavham/jreadability（MIT）](https://github.com/joshdavham/jreadability)
33. Waller, J. JLPT Resources（CC BY）. 经 [stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab) 与 jisho.org 采用

---

## 8. 附录：不确定项与未能证实的点

1. **"CAMBIUM" 语料未找到**：检索只命中 Cambium Assessment（美国测评公司，其员工 Kai North 在 TSAR 2024 发表 GPT-4 可读性研究），未发现名为 CAMBIUM 的 CEFR 语料。可能与其他名称混淆（最接近的是 Cambridge English Readability Dataset, Xia et al. 2016）。
2. **EFLLex 许可为二手确认**：CC BY-NC-SA 4.0 来自第三方研究仓库的元数据记录，官网下载页未见机器可读许可文件；商用前需向 CENTAL 核实。NC 条款意味着产品若商业化需替换词表（可改用 CEFR-J + Octanove + 自建标注，或申请 EVP 授权）。
3. **CEFR-SP 无显式开源许可**：GitHub 仅要求引用论文；Newsela 来源子集不公开。用它训练/评测时按"学术研究合理使用"对待，不内置进产品。
4. **LLM 评级的绝对准确率数字是单篇来源**：Reading.help（CHI 2026）的 GPT-4o 64%（句级）是在其自建词/句数据集上测得；跨域（RSS 新闻）表现未测。DeepSeek/Qwen 级别的国产模型没有公开的 CEFR 评级基准——**上线前应用 100–200 篇自采 RSS 做人工抽检校准**。
5. **95% 阈值的操作化有自由度**：token vs type、专名豁免口径、词形还原质量都会移动几个百分点；文献中的阈值基于词族（word family）而非 lemma，本项目用 lemma 是更宽松的口径。阈值必须作为可校准参数。
6. **Duolingo CEFR Checker 的内部算法细节未完全公开**：词级标签器"词频+语义建模"的具体方法、各语言准确率均未见论文；博客原文已迁移（2019 年发布），本次经中文译文、第三方转述与 UCLouvain 讲座摘要交叉确认。
7. **个性化覆盖率的校准曲线无公开实证**：LingQ 的 "% new words" 与用户体验的关系（10–20% 甜区）来自社区论坛经验，非受控研究。
8. **jReadability 与 JLPT 的对齐是间接的**：其 6 级模型标定自教材分级语料，与 JLPT N5–N1 的映射是社区惯例而非官方对应。
9. **LLM 降级改写的质量评估**：TSAR 2024/2025 证明方向可行，但"改写到 A1 后信息保真度"的自动验收指标不成熟——若启用改写路线，验收规则（覆盖率必须达标 + 语义保持抽检）需自行设计。
10. **DeepSeek/Qwen 定价变动频繁**（2026 年内已多次调价并变更峰谷计费），文中数字仅用于量级估算，以官方定价页为准。
