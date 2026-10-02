# 语言学约束的语言学习 Agent：实证依据与架构选型

- 日期：2026-10-02
- 问题：如何让语言学约束 agent、让讲解更全面，同时用户不需要深入语言学、不增加负担？
- 方法：一手学术文献（元分析、实验研究、数据库官网）优先；区分【学界共识】【主流共识】【有争议】【单一学派/传统主张】【未找到直接证据】五级标注。

---

## 1. TL;DR（设计判断）

1. **显性讲解该做。** 两个大规模元分析（Norris & Ortega 2000，Spada & Tomita 2010）一致显示显性教学效果显著优于隐性教学（d≈1.13 vs 0.54；复杂语法特征 d=0.88 vs 0.39），且效果持久、可迁移到自由产出。主流立场是 Ellis 的 **弱接口（weak interface）**：显性知识不会直接"变成"隐性知识，但能促进注意（noticing）、监控和自动化练习的起点。反直觉但重要：越是"复杂"的语法点，显性讲解相对收益越大。【学界共识级】
2. **"语言思维差异"最站得住的学术对应物是 Slobin 的 "thinking for speaking"（说话时的思维）**：每种语言的强制性语法范畴训练说话者在编码话语时注意经验的特定侧面；二语学习的难点是重构这套注意分配模式。它比"语言决定论"窄得多、实证支持稳得多（运动事件类型学有大量跨语言证据）。**强版 Sapir-Whorf 已被否定**；Boroditsky 著名的"中文时间垂直思维"实验被多次独立复制失败，不应作为教学内容。用户说的"英语重形合、中文重意合"源自 Nida（1982）与连淑能（1993）的中外对比语言学/翻译学传统——是**教学上有用的描写性概括，不是类型学定律**，应标注为倾向而非规则。
3. **约束架构推荐：结构化知识条目 + 检索增强（RAG）+ 分层解释模板 + CEFR 分级对齐**的组合。依据链：(a) 受教学设计约束的 LLM tutor 在 RCT 中有效（Kestin et al. 2025，效应量约 0.6–1.3 SD），而无护栏的通用 LLM 会损害学习（Bastani et al. 2025，PNAS：练习成绩提高、独立考试成绩反而下降）；(b) 认知负荷理论的专长逆转效应（Kalyuga et al. 2003）直接要求"同一现象多深度、按水平呈现"；(c) RAG/grounding 是降低幻觉的标准手段（Lewis et al. 2020）。**语言学对用户不可见**：它进知识库和生成约束，不出现在 UI 主路径；术语永远在第 3 层（可选展开）。
4. **不要做的事**：不要把"思维差异"包装成决定论；不要让 LLM 自由生成"语言学解释"而不接地；不要假设单一学派（生成语法/认知语法任一家）的解释是"定论"。

---

## 2. 显性语法教学的证据与边界

### 2.1 元分析证据

| 研究 | 范围 | 关键结果 | 来源 |
|---|---|---|---|
| Norris & Ortega (2000) | 49 项研究（1980–1998） | 显性教学 d≈1.13（大），隐性教学 d≈0.54（中）；显性优势在延迟后测仍保持；Focus on Form 有效 | [Language Learning 50(3):417–528, DOI 10.1111/0023-8333.00136](https://doi.org/10.1111/0023-8333.00136) |
| Spada & Tomita (2010) | 30 项研究/41 个样本 | 显性教学对**复杂**特征 d=0.88、简单特征 d≈0.73；隐性教学仅 0.39/0.33；显性教学的效果在自由产出任务上依然成立（复杂特征自由产出 d≈0.86） | [Language Learning 60(2):263–308, DOI 10.1111/j.1467-9922.2010.00562.x](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9922.2010.00562.x) |
| Goo et al. (2015) | N&O 2000 的更新版 | 显性教学对语法特征 g=1.06（大）、语用特征更大；隐性教学对语法仅中等（g≈0.60） | [收录于 Rebuschat (ed.) Implicit and Explicit Learning of Languages, Benjamins, DOI 10.1075/sibil.48.18goo](https://benjamins.com/catalog/sibil.48.18goo) |

设计含义的要点：**"复杂规则没法教、只能自然习得"的说法被 Spada & Tomita 直接证伪**——恰恰相反，复杂特征更需要显性教学。隐性教学不是无效，是效果小得多。

### 2.2 接口之争（Ellis 三种立场）的现状

- **强接口**（strong interface，DeKeyser 技能习得路线）：显性知识经练习可转化为隐性知识。
- **弱接口**（weak interface，Ellis）：显性知识间接促进隐性习得——使输入中的特征变显著（noticing）、充当监控器、为自动化练习提供起点。
- **无接口**（non-interface，Krashen）：习得与学习是分离系统，显性知识不能转化。

现状判定：**显隐知识是两种可分离的心理构念有心理测量学支持**（Ellis 2005, [SSAL 27(2), DOI 10.1017/S0272263105050096](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/measuring-implicit-and-explicit-knowledge-of-a-second-language-a-psychometric-study/0708428E45AEA716C06E47ED37785D4E)）；三者之争细节未完全了结【有争议】，但**实践层面的主流共识**是：显性教学（尤其是结合交际情境的形式聚焦）有稳定、持久的收益——这正是元分析所显示的。给 agent 的含义：讲解语法"有用"，但它起作用的方式是**促进注意与监控**，所以讲解应尽量贴着学习者当下遇到的真实语料（即 Long 的 focus on form 精神），而不是脱离语境先讲一遍规则表。

### 2.3 Focus on form vs focus on formS

- Long (1991) 区分：focus on form（FonF）= 在以意义为主的交际中**因需而就地**把注意力引向语言形式；focus on formS（FonFS）= 按结构大纲孤立、预先地逐个教离散语法点。来源：Long, M. (1991). Focus on form: A design feature in language teaching methodology. In *Foreign Language Research in Cross-Cultural Perspective*；Long & Robinson (1998) in Doughty & Williams (eds.) *Focus on Form in Classroom SLA*, CUP。【主流共识：FonF 优于纯 FonFS；但注意 Norris & Ortega (2000) 发现 FonFS 型教学同样有效，只是效果不如 FonF 持久——"结构大纲教学完全无效"是过度引申】
- 设计含义：agent 天然适合做 FonF——在用户产出的具体句子上就地聚焦形式，而不是先修完语法课。

### 2.4 元语言意识

- 元语言知识/意识与二语水平**相关**：Roehr (2008) 在大学生德语学习者中测得 r≈.81 的强相关；Alderson et al. (1997) 为弱到中等相关；Roehr-Brackin & Tellier (2019) 在儿童中发现元语言意识与语言学能正相关。来源见 [Roehr-Brackin (2018) *Metalinguistic Awareness and Second Language Acquisition*, Routledge](https://www.routledge.com/)（该书系统综述了此领域）。
- **边界【有争议】**：相关≠因果，且相关在高水平学习者中更强（鸡生蛋问题：高水平者本来就更会谈论语言）。没有证据表明"多学语言学术语"本身提升交际能力。
- 设计含义：**对谁有用、讲多深**：显性讲解对成人、分析型/高学能学习者、需要监控的读写场景收益最大；术语本身不是教学目标，是可选的放大器。这直接支持分层设计（见 §5.2）。

---

## 3. 语言思维差异：学术概念地图

### 3.1 语言相对论（Sapir–Whorf）

| 版本/主张 | 状态 | 依据 |
|---|---|---|
| 强决定论（语言决定思维，无法思考语言不表达的范畴） | 【学界共识：已被否定】 | 普遍认知能力的证据与跨范畴思考能力证伪；教科书级结论 |
| 弱效应/neo-Whorfian：语言影响注意、记忆、范畴边界的**在线处理偏向** | 【主流共识：存在但效应小、任务依赖】 | 颜色范畴边界效应（俄语蓝）：Winawer et al. (2007), [PNAS 104(19):7780–7785](https://www.pnas.org/doi/10.1073/pnas.0701644104)；空间参照系（绝对坐标语言如 Guugu Yimithirr）：Levinson (2003) *Space in Language and Cognition*, CUP（量级与普遍性有争论） |
| Boroditsky (2001) "普通话者垂直思考时间" | 【复制失败，不应作为教学内容】 | 六次独立复制失败：January & Kako (2007), [Cognition 104(2), DOI 10.1016/j.cognition.2006.09.001](https://www.sciencedirect.com/science/article/pii/S0010027706001582)；Chen (2007), [Cognition 104(2):427–436](https://pubmed.ncbi.nlm.nih.gov/17070793/)（普通话者实际更多用水平隐喻） |
| Keith Chen (2013) "无时态语言者更储蓄" | 【有争议，方法学质疑严重】 | Chen (2013) [AER 103(2):690–731](https://www.aeaweb.org/articles?id=10.1257/aer.103.2.690)；Roberts, Winters & Chen (2015) [PLoS ONE 10(7):e0132145](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0132145) 控制语系相关性后效应消失 |

### 3.2 Slobin 的 "thinking for speaking"——用户直觉的学术对应物【主流共识级】

- 原文主张（Slobin 1987, 1996）：语言在**说话时**强制说话者注意其语法必须编码的经验维度（如时体、运动路径/方式的词汇化模式）；每种语言"训练"其说话者注意事件的不同细节。关键句："the training one receives in childhood is exceptionally resistant to restructuring in adult second-language acquisition"（Slobin 1996: 89）。
- 实证支持：运动事件表达的类型学证据扎实（Talmy 的 satellite-framed vs verb-framed 类型学 + Slobin 的跨语言叙事研究，如"青蛙故事"项目）。
- 对二语的启示：Han & Cadierno (eds., 2010) *Linguistic Relativity in SLA: Thinking for Speaking*（Multilingual Matters）系统探讨：成人二语者的 L1 说话思维持续影响 L2 表达（概念迁移）；重构是可能的但困难，且随水平提高部分可达成（如中英学习者运动事件认知模式的研究，[PMC5461365](https://pmc.ncbi.nlm.nih.gov/articles/PMC5461365/)）。教学应用已有个案：Frontiers in Communication 2022 的 [mindful conceptual engagement 教运动事件](https://www.frontiersin.org/articles/10.3389/fcomm.2022.867346/full)。
- **设计含义**：这就是"语言表达的思维"的合法版本——不是"中英思维不同"这种宏大决定论，而是"这个语言的语法**逼你说话时注意什么**"的具体清单（英语必须标时态、主语；运动动词必须区分方式/路径；冠词必须定指/不定指……）。这些是可教、可对比、可解释的，且天然引发学习者兴趣。

### 3.3 对比分析与语言迁移

- Lado (1957) *Linguistics Across Cultures* 的强版对比分析假设（差异=困难，可预测错误）在 1960–70 年代被证伪：预测的错误不出现，出现的错误未被预测；差异有时反而容易（过于显眼），相似反而更坑（假朋友）。【学界共识：强版已否定】
- 弱版存活并现代化为**跨语言影响（CLI）**：Odlin (1989) *Language Transfer*, CUP——迁移真实存在但机制复杂，含回避、借用、概念迁移等多形态；Jarvis & Pavlenko (2008) *Crosslinguistic Influence in Language and Cognition*, Routledge——CLI 的当代分类框架（含概念迁移、双向迁移）。
- 教学含义【主流共识】：**面向特定 L1 的针对性讲解有依据**（已知高频迁移点值得显性提醒）；但不能把"差异表"当错误预测器。

### 3.4 "英语重形合、中文重意合"的来源与地位

- 出处：Nida (1982) *Translating Meaning* 提出形合/意合是英汉最重要的区别之一；连淑能《英汉对比研究》（1993，高等教育出版社）系统化为"英语重形合（hypotaxis，显性接应 overt cohesion）、汉语重意合（parataxis，隐性连贯 covert coherence）"；刘宓庆等亦有系统论述。在中国对比语言学/翻译教学界是标准内容。
- 地位判定：【单一学派/传统主张，作为教学性概括可用】。注意两点：(a) 国际类型学中 hypotaxis/parataxis 指小句连接方式（主从 vs 并列），"英语=形合语、汉语=意合语"是对该对术语的扩展用法，不是类型学分类结论；(b) 与之对应、国际学界更通行的框架是 Li & Thompson (1976) 的**主语突出 vs 话题突出**（subject-prominent vs topic-prominent）类型学。若 agent 要讲这类对比，建议同时用"话题突出/主语突出"这一更严格的框架表述，并标注为**倾向**而非铁律。
- 未找到直接证据：「了解这类差异能提升学习动机/兴奋感」——未见实证研究，属合理但未经检验的产品假设。

### 3.5 构式语法与用法本位/认知语言学的教学应用

- 理论：Goldberg (1995, 2006) 构式语法；Tomasello (2003) 用法本位习得理论；Ellis 的 usage-based SLA（频率、构式、语块的核心地位有较好支持）。
- 教学实验：Tyler, Mueller & Ho (2011) 用认知语言学的多义网络（意象图式）教介词 to/for/at，实验组显著优于传统教学，[VIAL 8:122–140](https://revistas.uvigo.es/index.php/vial/article/download/45/45/89)；Tyler & Evans (2003) *The Semantics of English Prepositions*, CUP 是底层分析。Tyler (2012) *Cognitive Linguistics and Second Language Learning*, Routledge 综述承认：方向一致、结果有前景，但**实验规模小、缺大规模独立复制**【证据中等：有前景，非定论】。
- 设计含义：介词、情态动词、短语动词这类"规则讲不清"的领域，意象图式+原型+多义网络的讲解方式有实证支持，适合做进知识条目的第 2/3 层（见 §5.2）。

---

## 4. 可用的语言学知识资源清单

| 资源 | 覆盖 | 许可/获取 | URL |
|---|---|---|---|
| **Glottolog** | 全球语言谱系分类、书目（Glottocode 标识符），~8000 语言/方言 | CC BY 4.0，可下载 | https://glottolog.org |
| **WALS**（World Atlas of Language Structures） | 192 个结构特征 × 2662 语言（语序、格标记、时体等类型学特征） | CC BY 4.0，在线+下载 | https://wals.info |
| **Grambank** | 195 个语法特征 × 2467 语言（形态句法粒度比 WALS 细） | CC BY 4.0（Skirgård et al. 2023, [Science Advances, DOI 10.1126/sciadv.adg6175](https://www.science.org/doi/10.1126/sciadv.adg6175)） | https://grambank.clld.org |
| **CEFR 及 Companion Volume (2020)** | 交际能力描述符（语法准确度、语用、中介策略等），A1–C2 分级 | 欧洲委员会版权，官网免费下载；教育引用需注明出处；非开放数据许可，商用需确认 | https://www.coe.int/en/web/common-european-framework-reference-languages |
| **English Grammar Profile (EGP)** | 英语学习者按 CEFR 级别的语法"criterial features"（基于剑桥学习者语料库的实证分级） | English Profile 项目官网免费在线查询；与 EVP（English Vocabulary Profile，词汇分级）同属该项目 | https://englishprofile.org/english-grammar-profile |
| **CEFR-J**（日本版） | 适配东亚学习者的词表/语法分级（含 A1 以下细分），免费下载 | 研究免费获取 | http://www.cefr-j.org |
| **FrameNet / English Constructicon** | 构式（form-meaning pair）数据库 | 研究免费（FrameNet 需注册） | https://framenet.icsi.berkeley.edu |

用途映射：**WALS/Grambank** 回答"这个现象跨语言多普遍/多特殊"（grounding 类型学宣称）；**CEFR/EGP** 回答"这个语法点该对什么级别的学习者讲、讲到什么程度"（讲解深度的分级锚）；**Glottolog** 提供语言谱系背景。注意：这些库**不含面向学习者的解释文本**——它们提供的是"事实锚"，解释仍需按 §5 的模板生成并受这些锚约束。

---

## 5. 约束 Agent 的架构选项对比

### 5.1 选项一览

| 方案 | 做法 | 证据/依据 | 成本/风险 | 评级 |
|---|---|---|---|---|
| **A. 结构化知识条目 + RAG**（推荐主干） | 人工/半自动编写"语言点条目"（现象、跨语言对比、例句、常见错误、CEFR 级别、来源），agent 检索后据此生成；无条目时降级为保守回答并标注不确定 | RAG grounding 降幻觉（Lewis et al. 2020, [NeurIPS 2020](https://proceedings.neurips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html)）；受课程知识约束的 LLM tutor 有效（Kestin et al. 2025, [Scientific Reports 15:17458, DOI 10.1038/s41598-025-97652-6](https://www.nature.com/articles/s41598-025-97652-6)） | 条目库建设成本高；覆盖面有限（冷启动问题） | ★★★★★ |
| **B. 分层解释模板**（推荐与 A 组合） | 同一现象三层：L1 直觉例句+对比 → L2 规律（无术语） → L3 术语/理论（可选展开）；默认只出 L1–L2 | 认知负荷理论专长逆转效应（Kalyuga et al. 2003, [Educational Psychologist 38(1):23–31](https://doi.org/10.1207/S15326985EP3801_4)）：新手需引导、专家被冗余讲解拖累；scaffolding 三要素=按需、渐撤、移交责任（van de Pol et al. 2010, [DOI 10.1007/s10648-010-9127-6](https://doi.org/10.1007/s10648-010-9127-6)）；元语言意识研究显示术语对低水平者收益不明（§2.4） | 模板需按语言点实例化，属内容工程 | ★★★★★ |
| **C. CEFR/EGP 分级对齐**（推荐与 A/B 组合） | 条目标注级别；讲解深度、词汇难度按学习者级别自适应（初学者不给从句嵌套的解释） | CEFR 是欧洲官方框架；EGP 提供实证分级锚（§4）；专长逆转效应提供"按水平调节深度"的理论依据 | EGP 只覆盖英语；其他语言缺实证分级 | ★★★★☆ |
| **D. 纯提示词约束**（系统提示中写教学原则，无知识库） | 零内容工程 | Bastani et al. 2025 ([PNAS 122(26):e2422633122](https://www.pnas.org/doi/10.1073/pnas.2422633122)）证明提示词护栏能大幅减害，但无知识接地时事实性错误无法杜绝 | 幻觉风险高；跨语言宣称无出处 | ★★☆☆☆（可作过渡，不可作终态） |
| **E. 知识图谱/本体全形式化**（先建本体再生成） | 语言知识本体约束一切输出 | **未找到直接证据**：未见"LLM 语言教学 + 语言学本体约束生成"的已发表实证研究；ITS 传统（认知导师等）用显式领域模型有效（VanLehn 2011 元分析显示 ITS 接近人类辅导效果） | 前期建模成本极高，语言学本体本身有学派分歧 | ★★☆☆☆（长期方向，非 MVP） |

### 5.2 推荐组合的具体形态

1. **知识条目 schema（最小集）**：`现象ID | 语言 | 一句话直觉描述 | 例句对（目标语/学习者母语） | 规律（无术语版） | 跨语言对比（含 WALS/Grambank 特征锚） | 与学习者母语的关键差异（CLI 锚） | 常见学习者错误 | CEFR 级别 | 理论解释（标注学派与共识等级） | 来源`。
2. **生成时约束**：agent 必须先检索条目；讲解默认输出 L1–L2 层；L3 层（术语/理论）仅在用户追问"为什么/还有吗"或条目标注"该用户级别可呈现"时展开；所有跨语言宣称必须挂特征锚或标注"倾向性概括"。
3. **深度控制参数**：学习者级别（CEFR）、当前任务是口语还是写作（监控需求不同）、用户历史上对术语层的展开率。

---

## 6. 风险与幻觉防护

1. **伪语言学解释**：LLM 会生成"看似合理但编造的规则"（如臆造的语法例外、错误的词源、虚构的跨语言规律）。防护：(a) 事实性宣称必须来自检索到的条目（RAG grounding，Lewis et al. 2020）；(b) 跨语言/类型学宣称必须有 WALS/Grambank 锚或被显式标注为"倾向性概括/教学性说法"；(c) 无条目时的降级策略=给出保守答案+不确定性标注，而非自由发挥。通用结论：无护栏 LLM 辅助会损害独立表现（Bastani et al. 2025），护栏是架构问题不是提示词问题。
2. **学派争议渗入教学内容**：生成语法 vs 认知/功能学派在"语法本质是什么"上无共识；但**教学语法（pedagogical grammar）在实践层面高度理论中立**（时态、语序、搭配的教法和例句各学派差异很小）。风险主要在"为什么"层：同一现象不同学派给出不同解释。对策：L3 层允许多解释并存并标注学派；禁止 agent 把任何单一理论解释表述为"语言学定论"。
3. **把弱效应讲成强决定论**：内容审核清单——涉及"语言与思维"的条目，一律按 §3.1 的共识等级表措辞（"说话时注意"而非"无法思考"；"倾向"而非"定律"）。Boroditsky 2001 时间实验、Keith Chen 2013 储蓄研究这类**复制失败/争议**案例不得作为正面教学材料。
4. **对比语言学传统说法的过度推广**："英语形合/汉语意合"类表述标注为倾向+配以国际通行的对应框架（话题突出 vs 主语突出），防止学习者形成"中文不讲逻辑/英语不讲意境"的刻板印象。
5. **认知超载与依赖**：默认浅层呈现（专长逆转效应）；scaffolding 需渐撤（van de Pol et al. 2010）——同一语言点已掌握后，agent 应停止主动讲解。

---

## 7. 参考文献汇总

**显性教学与接口之争**
1. Norris, J. M., & Ortega, L. (2000). Effectiveness of L2 instruction: A research synthesis and quantitative meta-analysis. *Language Learning*, 50(3), 417–528. https://doi.org/10.1111/0023-8333.00136
2. Spada, N., & Tomita, Y. (2010). Interactions between type of instruction and type of language feature: A meta-analysis. *Language Learning*, 60(2), 263–308. https://doi.org/10.1111/j.1467-9922.2010.00562.x
3. Goo, J., Granena, G., Yilmaz, Y., & Novella, M. (2015). Implicit and explicit instruction in L2 learning: Norris & Ortega (2000) revisited and updated. In P. Rebuschat (Ed.), *Implicit and Explicit Learning of Languages*. Benjamins. https://doi.org/10.1075/sibil.48.18goo
4. Ellis, R. (2005). Measuring implicit and explicit knowledge of a second language: A psychometric study. *Studies in Second Language Acquisition*, 27(2), 141–172. https://doi.org/10.1017/S0272263105050096
5. Long, M. (1991). Focus on form: A design feature in language teaching methodology. In *Foreign Language Research in Cross-Cultural Perspective*. Benjamins.
6. Long, M., & Robinson, P. (1998). Focus on form: Theory, research, and practice. In Doughty & Williams (Eds.), *Focus on Form in Classroom SLA*. CUP.
7. Roehr, K. (2008). Metalinguistic knowledge and language ability in university-level L2 learners. *Applied Linguistics*, 29(2), 173–199.
8. Roehr-Brackin, K. (2018). *Metalinguistic Awareness and Second Language Acquisition*. Routledge.
9. Roehr-Brackin, K., & Tellier, A. (2019). The role of language-analytic ability in children's instructed second language learning. *Studies in Second Language Acquisition*, 41(5).

**语言思维差异**
10. Winawer, J., et al. (2007). Russian blues reveal effects of language on color discrimination. *PNAS*, 104(19), 7780–7785. https://doi.org/10.1073/pnas.0701644104
11. Levinson, S. C. (2003). *Space in Language and Cognition*. CUP.
12. Boroditsky, L. (2001). Does language shape thought? Mandarin and English speakers' conceptions of time. *Cognitive Psychology*, 43, 1–22.（复制失败）
13. January, D., & Kako, E. (2007). Re-evaluating evidence for linguistic relativity: Reply to Boroditsky (2001). *Cognition*, 104(2), 417–426. https://doi.org/10.1016/j.cognition.2006.09.001
14. Chen, J.-Y. (2007). Do Chinese and English speakers think about time differently? Failure of replicating Boroditsky (2001). *Cognition*, 104(2), 427–436.
15. Chen, M. K. (2013). The effect of language on economic behavior. *American Economic Review*, 103(2), 690–731. https://doi.org/10.1257/aer.103.2.690
16. Roberts, S. G., Winters, J., & Chen, K. (2015). Future tense and economic decisions: Controlling for cultural evolution. *PLoS ONE*, 10(7), e0132145. https://doi.org/10.1371/journal.pone.0132145
17. Slobin, D. I. (1996). From "thought and language" to "thinking for speaking". In Gumperz & Levinson (Eds.), *Rethinking Linguistic Relativity*. CUP.
18. Han, Z., & Cadierno, T. (Eds.) (2010). *Linguistic Relativity in SLA: Thinking for Speaking*. Multilingual Matters.
19. Talmy, L. (2000). *Toward a Cognitive Semantics*, Vol. II. MIT Press.
20. Lado, R. (1957). *Linguistics across Cultures*. University of Michigan Press.
21. Odlin, T. (1989). *Language Transfer: Cross-Linguistic Influence in Language Learning*. CUP.
22. Jarvis, S., & Pavlenko, A. (2008). *Crosslinguistic Influence in Language and Cognition*. Routledge.
23. Nida, E. A. (1982). *Translating Meaning*. Summer Institute of Linguistics.
24. 连淑能 (1993/2010). 《英汉对比研究》. 高等教育出版社.
25. Li, C. N., & Thompson, S. A. (1976). Subject and topic: A new typology of language. In Li (Ed.), *Subject and Topic*. Academic Press.
26. Goldberg, A. E. (2006). *Constructions at Work*. OUP.
27. Tomasello, M. (2003). *Constructing a Language: A Usage-Based Theory of Language Acquisition*. Harvard UP.
28. Tyler, A., & Evans, V. (2003). *The Semantics of English Prepositions*. CUP.
29. Tyler, A., Mueller, C. M., & Ho, V. (2011). Applying cognitive linguistics to learning the semantics of English to, for and at: An experimental investigation. *VIAL*, 8, 122–140.
30. Tyler, A. (2012). *Cognitive Linguistics and Second Language Learning: Theoretical Basics and Experimental Evidence*. Routledge.

**Agent 架构与教学设计**
31. Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). AI tutoring outperforms in-class active learning: An RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports*, 15, 17458. https://doi.org/10.1038/s41598-025-97652-6
32. Bastani, H., Bastani, O., Sungu, A., Ge, H., Kabakcı, Ö., & Mariman, R. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *PNAS*, 122(26), e2422633122. https://doi.org/10.1073/pnas.2422633122
33. VanLehn, K. (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems. *Educational Psychologist*, 46(4), 197–221.
34. Lewis, P., et al. (2020). Retrieval-augmented generation for knowledge-intensive NLP tasks. *NeurIPS 33*.
35. Sweller, J., van Merriënboer, J. J. G., & Paas, F. G. W. C. (1998). Cognitive architecture and instructional design. *Educational Psychology Review*, 10, 251–296.
36. Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist*, 38(1), 23–31. https://doi.org/10.1207/S15326985EP3801_4
37. van de Pol, J., Volman, M., & Beishuizen, J. (2010). Scaffolding in teacher–student interaction: A decade of research. *Educational Psychology Review*, 22, 271–296. https://doi.org/10.1007/s10648-010-9127-6
38. Wood, D., Bruner, J., & Ross, G. (1976). The role of tutoring in problem solving. *Journal of Child Psychology and Psychiatry*, 17(2), 89–100.
39. Skirgård, H., et al. (2023). Grambank reveals the importance of genealogical constraints on linguistic diversity. *Science Advances*, 9(20), eadg6175. https://doi.org/10.1126/sciadv.adg6175
40. Council of Europe (2020). *CEFR Companion Volume with New Descriptors*. https://www.coe.int/en/web/common-european-framework-reference-languages
41. English Profile Programme. English Grammar Profile / English Vocabulary Profile. https://englishprofile.org

---

## 8. 附录：不确定项与未决问题

1. **"知识本体约束生成"的直接证据缺失**：找到的是 ITS 领域模型有效 + LLM 提示词/RAG 护栏有效两条独立证据链；"语言学本体 + LLM 生成约束"的已发表实证研究未找到。方案 A/B/C 的推荐是基于证据链的组合推断，非直接实验。
2. **Kestin et al. (2025) 为单一物理课程、短期 RCT**；推广到语言学习需谨慎。Khanmigo 的独立功效研究截至调研时仍薄（EdTech Hub 综述指出正式效果研究有限）。
3. **认知语言学教学实验**（Tyler 系列）样本小、多为单实验、缺大规模独立复制；方向一致但强度未知。
4. **元语言意识与习得之间为相关性证据**，因果方向未定；"讲术语能提升兴奋感/动机"无任何直接实证，是待验证的产品假设。
5. **非英语语言的 CEFR 实证分级资源**（对应 EGP）基本缺失；其他语言只能用 CEFR 通用描述符，粒度粗。
6. **"thinking for speaking" 的课堂教学干预**仅见个案（如 Frontiers 2022 运动事件教学），无元分析级证据。
7. CEFR 描述符的**商用许可以及将其结构化入库的版权边界**需向欧洲委员会确认；EGP 数据同理（官网免费查询，批量使用条款未核实）。
