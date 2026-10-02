# 语块驱动学习与复习机制的实证研究综述

> 研究日期：2026-10-02
> 背景：语言学习 agent 设计——用户订阅/投喂真实内容 → 提取语块 → 先学语块 → 回到原内容（兴趣驱动闭环）。
> 方法：结论尽量回溯到一手文献（DOI/期刊官方页）或产品官方页面；区分"有实证支持"与"理论合理但未验证"；未找到证据的点明确标注。

---

## 1. TL;DR（给开发者的设计判断）

**这个玩法的"零件"几乎都有实证背书，但"整机"（完整闭环）没有被直接验证过——它是多个证据链的工程学组装，主要风险不在学习科学，而在自动化语块提取质量和用户长期留存。**

### 有实证背书（可放心作为设计公理）

| 玩法环节 | 证据强度 | 关键证据 |
|---|---|---|
| 语块（formulaic sequences）是语言加工与流利度的核心单位 | **强** | Wray (2002) 定义；Conklin & Schmitt (2008) 加工优势；Tavakoli & Uchihara (2020) 与流利度相关 |
| 先学词汇再读文本（pre-teaching）对**该文本**的理解和词汇习得有效 | **中等偏强** | Pellicer-Sánchez et al. (2022) 眼动实验；Pujadas & Muñoz (2019)；Stahl & Fairbanks (1986) 元分析 |
| 覆盖率阈值：阅读 ~95–98%，视听可低至 ~90% | **强**（但注意"阈值"被复制研究弱化为"连续关系"） | Nation (2006)；Hu & Nation (2000)；Schmitt et al. (2011)；Laufer & Ravenhorst-Kalovski (2010)；Durbahn et al. (2024)；Kremmel et al. (2023) 的复制 |
| 兴趣→更深的加工、更好的主旨回忆、更多附带词汇习得 | **中等偏强** | Schiefele (1999)；Schiefele, Krapp & Winteler (1992, r≈.30)；Lee & Pulido (2017)；SDT×L2 元分析（内在动机 r≈.32） |
| 复习用提取练习 + 间隔 | **很强**（整个学习科学中最稳的发现之一） | Karpicke & Roediger (2008)；Dunlosky et al. (2013)；Cepeda et al. (2006) |
| 目标词在主题相关内容中反复复现（窄读/窄输入） | **中等** | Krashen (2004) 论述 + Kang (2015)、Chang & Renandya (2021) 实验；REAP 系统先例 |

### 属于"赌"的部分（设计时必须自己承担验证责任）

1. **完整闭环未验证**：未找到"从用户自选内容提取语块 → 预教 → 用户回到原内容"的已发表端到端研究。最接近的是 CMU 的 REAP 系统（反方向：先有目标词，再从网上检索含目标词的真实文本），课堂实验显示效果不差于教师选材（见 §6）。
2. **"预教语块"（而非单词）的剂量与选块标准没有定论**：教多少块、按什么标准选（频率？可教性？对话性？）、预教多深，均无实证答案。Boers & Lindstromberg (2012) 的综述显示语块教学干预的效果普遍"小而杂"。
3. **"AI 生成文本用户不爱看"是假设不是结论**：直接证据稀少，且新近研究（Alghamdi & Alghizzi, 2026）反而显示按 CEFR 校准的 AI 生成文本可以提升阅读理解与参与度（单一研究，勿过度外推）。
4. **SRS 的长期合规性差**：Seibert Hanson & Brown (2020) 标题即结论——"effective but bitter pill"（有效但难以下咽的药丸）；使用天数与成绩正相关，但依从性随时间大幅下滑。游戏化有小的正面效果（g≈.25–.49）但受新颖性衰减制约。

---

## 2. 语块与预教学：证据与边界

### 2.1 语块在 SLA 中的地位

**定义**（Wray, 2002, p.9，被引最多的心理语言学定义）：

> "a sequence, continuous or discontinuous, of words or other elements, which is, or appears to be, prefabricated: that is, stored and retrieved whole from memory at the time of use, rather than being subject to generation or analysis by the language grammar."

- 来源：Wray, A. (2002). *Formulaic Language and the Lexicon*. Cambridge University Press.（引文转引自 [PMC10914984](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10914984/) 等多处）

**加工优势的实证**：

- **Conklin & Schmitt (2008)**：母语者和高水平二语者阅读高频 formulaic sequences 都比非程式化串**更快**，支持"整体存储/提取"假说。 *Applied Linguistics*, 29(1), 72–89. [DOI: 10.1093/applin/amm022](https://doi.org/10.1093/applin/amm022)
- **Tavakoli & Uchihara (2020)**：56 名 B1–C1 学习者，多词序列（MWS）的使用量与口语流利度、水平等级显著相关；高水平学习者更多使用 MWS。 *Language Learning*, 70(2), 506–547. [DOI: 10.1111/lang.12384](https://doi.org/10.1111/lang.12384)
- **Boers et al. (2006)** "Putting a Lexical Approach to the test"：小规模实验，接受语块强化教学组的口语被盲评者评为更流利/更像母语者。 *Language Teaching Research*, 10(3), 245–261. [DOI: 10.1191/1362168806lr195oa](https://doi.org/10.1191/1362168806lr195oa)（[ERIC 摘要](https://eric.ed.gov/?id=EJ805192)）

**边界与警告**：

- **Boers & Lindstromberg (2012)** 对 2004 年后全部实验/干预研究的综述：学习者确实能从语块库存中获益，但**学习者在语块上追赶母语者的速度很慢**，三类教学干预（引起注意、助记加工、输出练习）的效果**小且不一致**。 *Annual Review of Applied Linguistics*, 32, 83–110. [DOI: 10.1017/S0267190512000050](https://doi.org/10.1017/S0267190512000050)（[摘要页](https://www.cambridge.org/core/journals/annual-review-of-applied-linguistics/article/8728FEDCAB7A9A280B6EF1CD899B94B1)；[scite 摘要](https://scite.ai/reports/experimental-and-intervention-studies-on-JP9wx9)）
- 2026 年 SSLA 还有专文论证 "Formulaic Sequence 不能当万能术语"，概念边界（collocation / lexical bundle / idiom / construction）在实证上并不等同——**产品设计里"语块"的操作性定义需要自己拍板**。[SSLA, FORMULAIC SEQUENCE(FS) CANNOT BE AN UMBRELLA TERM IN SLA](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/formulaic-sequencefs-cannot-be-an-umbrella-term-in-sla/AFCD7233ACEC89C2A4314392127C5967)

### 2.2 Lewis 的 Lexical Approach（1993）：教学流派还是有实证支持的方法？

**判定：它是教学流派（pedagogical proposal），不是被实证检验过的"方法"。** Lewis (1993) *The Lexical Approach* (LTP) 与 Lewis (1997) *Implementing the Lexical Approach* 都是教学主张著作，其时代没有配套的受控实验。后来的实证工作（Boers et al. 2006；Boers & Lindstromberg 2009 *Optimizing a Lexical Approach*, Palgrave；Boers & Lindstromberg 2012 综述）为"以语块为教学单位"提供了**间接且混合**的支持：语块的心理现实性和与流利度的相关性有据（§2.1），但"按 Lexical Approach 整套流程教学优于 X"的严格 RCT 证据**未找到**。

### 2.3 预教词汇（pre-teaching before reading/listening）

**支持的实证**：

- **Pellicer-Sánchez et al. (2022)**（眼动研究，L1 与 L2 读者）："读前指导 + 阅读"条件在词汇学习收益上优于"仅阅读"和"仅指导"，作者归因于预教带来的额外汇入在阅读中被巩固。 *Language Learning*. [DOI: 10.1111/lang.12430](https://doi.org/10.1111/lang.12430)（[UCL 全文 PDF](https://discovery.ucl.ac.uk/id/eprint/10101629/1/Pellicer%20Sanchez_lang.12430.pdf)）
- **Pujadas & Muñoz (2019)**：青少年 EFL 学习者观看剧集，"聚焦条件（预教目标词）"比"非聚焦条件"词汇收益更高。 *Modern Language Journal*, 73(2).（[巴塞罗那大学仓储全文](https://diposit.ub.edu/bitstreams/85fa41f1-0cf8-4930-a94c-d1fe8d29646d/download)，被引 200+）
- **Stahl & Fairbanks (1986)** 经典元分析：词汇教学（含预教）对被教词的习得与含这些词的文本理解有可靠正效应。 *Reading Research Quarterly*, 21(1), 72–110.（[LINCS 重印版](https://lincs.ed.gov/publications/archive/chapter2.pdf)）
- 时序上，读前、读中、读后给词汇支持都有效（[Suzuki, Nakata & Rogers 2023 章节综述](https://yuichisuzuki.net/wp-content/uploads/2023/09/Suzuki-Nakata-Rogers-2023-Chapter2-postprint.pdf)）。

**反对意见与边界**：

- 预教的收益主要是**文本特定**的（帮助读懂"这一篇"、学会"这些词"），对泛化阅读能力的迁移证据弱；Stahl & Fairbanks (1986) 报告对整体阅读理解的效应小于对目标词本身的效应。
- 预教剂量与记忆保持直接冲突：一次性预教大量生词违反"分散练习"原则，且没有提取练习配合时遗忘快（见 §4）。**设计含义：预教要短、要与紧接着的内容强绑定，并把"回到内容后再次遇见"当作复习的第一环。**

### 2.4 覆盖率阈值：95%/98% 的原文结论与当代修正

- **Nation (2006)** *How Large a Vocabulary Is Needed for Reading and Listening?* *Canadian Modern Language Review*, 63(1), 59–82. [DOI: 10.3138/cmlr.63.1.59](https://doi.org/10.3138/cmlr.63.1.59)。结论：书面文本 98% 覆盖约需 **8,000–9,000 词族**，口语约需 **6,000–7,000 词族**；95% 覆盖所需词汇量小得多（小说约 4,000 词族）。
- **Hu & Nation (2000)**：98% 覆盖处多数读者可无辅助理解小说文本；95% 处多数不行。 *Reading in a Foreign Language*, 13(1), 403–430.（[RFL 存档](https://nflrc.hawaii.edu/rfl/)）
- **Schmitt, Jiang & Grabe (2011)**：理解率随覆盖率**近线性**上升；即使 100% 覆盖学习者理解也非满分；支持把 98% 作为"稳妥理解"的工作目标。 *Modern Language Journal*, 95(1), 26–43. [DOI: 10.1111/j.1540-4781.2011.01146.x](https://doi.org/10.1111/j.1540-4781.2011.01146.x)
- **Laufer & Ravenhorst-Kalovski (2010)**：双阈值——**最低阈值 4,000–5,000 词族（95% 覆盖）**，**最优阈值 8,000 词族（98% 覆盖）**。 *SSLA*, 32(1).（结论转引自 [GUPEA 学位论文](https://gupea.ub.gu.se/bitstreams/7532fac0-cc80-4701-8e8b-b8585e76dd9c/download) 与 [Durbahn et al. 2024](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/lexical-coverage-in-l1-and-l2-viewing-comprehension/DFCA6605076705D5762C98F286D16B27)）
- **复制研究的修正——Kremmel, Indrarathne, Kormos & Suzuki (2023)**：在新语境复制 Hu & Nation，发现覆盖率与理解的关系**更接近连续线性而非"98% 临界阈值"**；其数据中 90% 覆盖处选择题理解正确率约 0.48–0.69，100% 覆盖处也只有约 0.45–0.76（取决于文本/题型）。 *Language Learning*, 73(4), 1127–1163. [DOI: 10.1111/lang.12622](https://doi.org/10.1111/lang.12622)。**设计含义：覆盖率应作为连续指标（"每提高 1% 覆盖，理解改善一分"），而非"低于 98% 不能读"的硬闸门——这对"预教 N 个块把覆盖率从 96% 抬到 98%"的产品逻辑反而是好消息。**
- **视听模态阈值更低**：Durbahn, Rodgers, Macis & Peters (2024) 发现观看视频时 **90% 覆盖即可达到"足够理解"**（字幕/画面等冗余信息补偿）。 *SSLA*, 46(4), 1045–1068.（[开放获取](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/lexical-coverage-in-l1-and-l2-viewing-comprehension/DFCA6605076705D5762C98F286D16B27)）；van Zeeland & Schmitt (2013) 听力研究也支持 90–95% 区间（*System*, 41, 609–624. [DOI: 10.1016/j.system.2013.07.012](https://doi.org/10.1016/j.system.2013.07.012)）。

### 2.5 Krashen 可理解输入假说的当代状态

- **支持的**：大规模意义聚焦输入有效的证据相当扎实——泛读元分析 Nakanishi (2015, *TESOL Quarterly*, 49(1), 6–37. [DOI: 10.1002/tesq.157](https://doi.org/10.1002/tesq.157)；34 研究、3,942 人，组间对照 **d≈0.46**）与更新的 Sangers et al. (2025, *Educational Psychology Review*, 37:96. [DOI: 10.1007/s10648-025-10068-6](https://link.springer.com/article/10.1007/s10648-025-10068-6)）。
- **否证/限定**：输入是**必要不充分**条件（Ellis 的立场，转引自 [批评文献](https://pmc.ncbi.nlm.nih.gov/articles/PMC12577063/)）；Swain 输出假说、Long 互动假说均指出纯输入路径的缺口；"i+1"不可操作化是老牌批评。2025 年的神经生态学批评（[PMC12577063](https://pmc.ncbi.nlm.nih.gov/articles/PMC12577063/)）认为该假说在神经科学层面缺乏对应机制。
- **判定**：把"可理解输入"作为产品的输入选择启发式（用户读得懂的内容）是安全的；把 Krashen 的强版本（"只需输入即可习得"）作为理论支柱则不稳妥。

---

## 3. 兴趣驱动的证据

### 3.1 兴趣→文本学习的机制证据（L1，可迁移到 L2 的证据也已有）

- **Schiefele (1999)** *Interest and learning from text*：兴趣高的读者**主旨回忆更好、回忆结构更连贯、深加工更多**，但逐字回忆不受影响——兴趣改善的是**深层理解**而非机械记忆。 *Scientific Studies of Reading*, 3(3), 257–279. [DOI: 10.1207/s1532799xssr0303_4](https://doi.org/10.1207/s1532799xssr0303_4)
- **Schiefele, Krapp & Winteler (1992)**：121 项研究的元分析，学科兴趣与学业成绩的**平均相关 r≈.30**（中等偏弱但稳定）。收录于 Renninger, Hidi & Krapp (Eds.), *The Role of Interest in Learning and Development* (pp.183–212).（[佐证](https://vdoc.pub/documents/metacognition-in-learning-and-instruction-theory-research-and-practice-so-convinced-that-metacognition-is-1873038) 见元分析教科书转述）
- **Hidi & Renninger (2006)** 四阶段模型：情境兴趣→个体兴趣的发展路径，为"先用用户当下的兴趣钩住，再培养稳定兴趣"提供框架。 *Educational Psychologist*, 41(2), 111–127. [DOI: 10.1207/s15326985ep4102_2](https://doi.org/10.1207/s15326985ep4102_2)

### 3.2 L2 专属证据

- **Lee & Pulido (2017)**：话题兴趣对 EFL 读者**附带词汇习得**有显著正向作用（同时受水平、性别调节）。 *Language Teaching Research*, 21(1), 118–135.（[ERIC 题录 EJ1124471](https://eric.ed.gov/?id=EJ1124471)，被引 140+）
- **Learning and Motivation (2023, DOI: 10.1016/j.lmot.2023.101920)**：话题兴趣提高 L2 附带词汇学习**和有效词典查询行为**——兴趣让用户更愿意查词，而查词行为本身促进习得（[ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0023969023000516)）。
- **自我决定理论×L2 的多层元分析（Alamer & Robat 等, 2025）**：内在动机与 L2 成绩正相关 **r≈.32**（校正后）。（[selfdeterminationtheory.org 全文](https://selfdeterminationtheory.org/wp-content/uploads/2025/06/2025_AlamerRobatEtAl_L2.pdf)）
- **Dörnyei 的 L2 动机自我系统（L2MSS）**：Al-Hoorie (2018) 元分析（32 报告、32,078 人）——理想 L2 自我与"主观意向努力"相关 **r=.61**，但与**客观成绩**的相关弱得多。 *SSLLT*, 8(4), 721–754. [DOI: 10.14746/ssllt.2018.8.4.2](https://doi.org/10.14746/ssllt.2018.8.4.2)（[ERIC EJ1202469](https://eric.ed.gov/?id=EJ1202469)）

### 3.3 边界

- 兴趣效应量级是 r≈.3 级别的**中等相关**，不是魔法开关；兴趣不能替代覆盖率（§2.4）与复习（§4）。
- "用户感兴趣的内容"≈ 个体兴趣（individual interest），比"教师制造的情境兴趣"更持久——产品的"用户自选内容"策略方向正确。
- 真实材料动机的直接证据多为小样本准实验：如真实材料组阅读理解、动机上升、焦虑下降（[Reading & Writing Quarterly, DOI: 10.1080/10573569.2021.1892001](https://www.x-mol.com/paper/1368819101738885120)）；也有初步研究发现真实 vs 人造材料对动机的差异不显著（[CJAL, DOI: 10.1515/cjal-2013-0029](https://www.degruyterbrill.com/document/doi/10.1515/cjal-2013-0029/html)）。**"真实材料更激发动机"方向上证据为正，强度有限。**

---

## 4. 复习机制：证据 → 可行的设计选项清单

### 4.1 提取练习（testing effect / retrieval practice）

- **Karpicke & Roediger (2008, *Science*)**——注意：**他们的实验材料正是外语词汇（斯瓦希里语—英语词对）**，与单词/语块学习直接对应。一周后测试：反复复测条件回忆率约 **80%**，同等时间重复学习条件约 **33–36%**——"多次重学"几乎不增加长期保持，"多次提取"是保持的决定因素。 *Science*, 319(5865), 966–968. [DOI: 10.1126/science.1152408](https://doi.org/10.1126/science.1152408)
- **Roediger & Karpicke (2006)**：5 分钟后重学组更高，**一周后出现交叉——测试组 ~61% vs 重学组 ~40%**。 *Psychological Science*, 17(3), 249–255. [DOI: 10.1111/j.1467-9280.2006.01693.x](https://doi.org/10.1111/j.1467-9280.2006.01693.x)
- **Dunlosky et al. (2013)**：10 种学习策略评级，**只有"练习测试"与"分散练习"获"高效用"评级**；重读、划线被评为低效。 *Psychological Science in the Public Interest*, 14(1), 4–58. [DOI: 10.1177/1529100612453266](https://doi.org/10.1177/1529100612453266)（后续 242 研究元分析确认了该排序，[DOAJ](https://doaj.org/article/3193f29b450640339dea0c3bade391de)）

### 4.2 Bjork 的 desirable difficulties

- 核心框架：Bjork & Bjork (2011) "Making things hard on yourself, but in a good way"（[UCLA Bjork Lab PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf)）——间隔、交错、生成、变化条件，**以降低当下表现为代价提高长期保持与迁移**。
- **词汇学习专属**：Bjork & Kroll (2015) "Desirable difficulties in vocabulary learning", *American Journal of Psychology*, 128(2), 241–252.
- 间隔在**语境化词汇学习**中同样有效：Nakata & Elgort (2021), *Second Language Research*, 37(4), 687–711.
- 反直觉的管理学含义：**让复习"有点费劲"是正确的**；产品设计常犯的错误是把复习做成再认（看一眼释义就翻卡），那只产生熟悉感（fluency illusion）。

### 4.3 SRS 的参与度/辍学问题（直接回答"背单词=无趣打卡"）

- **Seibert Hanson & Brown (2020)** *"Enhancing L2 learning through a mobile assisted spaced-repetition tool: an effective but bitter pill?"* *Computer Assisted Language Learning*, 33(1–2), 133–155. [DOI: 10.1080/09588221.2018.1552975](https://doi.org/10.1080/09588221.2018.1552975)（[作者公开 PDF](https://andymatuschak.org/files/papers/Seibert%20Hanson%20and%20Brown%20-%202020%20-%20Enhancing%20L2%20learning%20through%20a%20mobile%20assisted%20sp.pdf)）。大学西班牙语课学生用 Anki 一学期：**Anki 使用天数与期末水平显著正相关**（控制动机、自我效能后仍成立），但**依从性差异巨大且随时间下滑**（转引研究显示使用人数从 70 人降到 20 人 [RWTH 论文转引](https://publications.rwth-aachen.de/record/849937/files/849937.pdf)），学生报告不喜欢这个应用。→ **SRS 的药效取决于服用率，而服用率是产品设计问题，不是算法问题。**
- 医学教育领域队列研究同样显示 Anki 使用者成绩更高（[Gilbert et al. 2023, PMC10403443](https://pmc.ncbi.nlm.nih.gov/articles/PMC10403443/)），但为观察性、自选偏差大。
- **游戏化证据**：Sailer & Homner (2020) 元分析，认知 **g=.49**、动机 g=.36、行为 g=.25——**小效应**。*Educational Psychology Review*, 32, 77–112. [DOI: 10.1007/s10648-019-09498-w](https://doi.org/10.1007/s10648-019-09498-w)。Hamari, Koivisto & Sarsa (2014) 文献综述提醒：效果依赖情境、存在**新颖性衰减**（[DOI: 10.1109/HICSS.2014.377](https://doi.org/10.1109/HICSS.2014.377)）。
- **Duolingo 效能**：Vesselinov & Grego (2012)（公司委托、未同行评议、完成者 n=88 且自选偏差大）"34 小时 ≈ 大学一学期"；同行评议版本 Jiang et al. (2021, *Foreign Language Annals*, 54(4), 974–1002)：225 名仅用 Duolingo 的学习者完成初级课程后读/听达 ACTFL Intermediate Low/Mid，**约等于大学 4 学期且用时约一半**（[Duolingo 官方研究页](https://www.duolingo.com/efficacy/studies)）。注意：效能在**读/听**维度测量，口语/真实互动维度证据弱。
- Duolingo 自己的间隔模型（Half-Life Regression）有论文：Settles & Meeder (2016), *ACL*.（[ACL Anthology](https://aclanthology.org/P16-1174/)）

### 4.4 "目标语块在内容中复现"（窄读/窄输入 + 附带习得）

- **理论论述**：Krashen (2004) "The Case for Narrow Reading", *Language Magazine*, 3(5), 17–19（[作者官网 PDF](http://www.sdkrashen.com/content/articles/narrow.pdf)）；Schmitt & Carter (2000) "The lexical advantages of narrow reading", *TESOL Journal*, 9(1), 4–9. [DOI: 10.1002/j.1949-3533.2000.tb00220.x](https://doi.org/10.1002/j.1949-3533.2000.tb00220.x)
- **实验证据**：Kang (2015) "Promoting L2 vocabulary learning through narrow reading", *RELC Journal*, 46(2), 165–179. [DOI: 10.1177/0033688215586236](https://doi.org/10.1177/0033688215586236)；Chang & Renandya (2021) "The effect of narrow reading on L2 learners' vocabulary acquisition", *RELC Journal*, 52(3), 493–508. [DOI: 10.1177/0033688219871387](https://doi.org/10.1177/0033688219871387)——窄读组词汇习得优于对照。
- **附带习得的量级（泼冷水用）**：Webb, Uchihara & Yanagisawa (2023) 元分析（24 研究、2,771 人）：即时后测学会目标词的 **9–18%**，延迟后测 **6–17%**；模态差异小（读 17%/15%，听 15%/13%，边读边听 13%/17%，看视频仅 7%/5%）。 *Language Teaching*, 56. [DOI: 10.1017/S0261444822000507](https://doi.org/10.1017/S0261444822000507)（[Cambridge 摘要页](https://www.cambridge.org/core/journals/language-teaching/article/how-effective-is-second-language-incidental-vocabulary-learning-a-metaanalysis/E38E3468FD2090B1FA3051051DE8E70C)）
- **Waring & Takaki (2003)**：读一本 400 词头分级读物，多数生词**未被学会**，出现 10+ 次的词习得率最高，**三个月后保持率大幅衰减**。*Reading in a Foreign Language*, 15(2), 130–163. [DOI: 10.64152/10125/66776](https://doi.org/10.64152/10125/66776)（[ERIC EJ676380](https://eric.ed.gov/?id=EJ676380)）
- **Horst (2005)**：读整本分级读物（约 2 万词）的附带习得率显著高于单篇研究（部分指标 >40%），出现次数是关键调节变量。 *CMLR*, 61(3), 355–382. [DOI: 10.3138/cmlr.61.3.355](https://doi.org/10.3138/cmlr.61.3.355)
- **含义**：单次遇见几乎不形成记忆；**产品价值恰恰在于人为制造"受控复现"**——要么窄主题推送（同主题多来源），要么预教+回到内容形成的"刻意+附带"混合环路。这正是"复习"可以摆脱孤立词卡的证据基础。

### 4.5 AI 生成文本 vs 真实语料

- **未找到**关于"学习者对 AI 生成阅读材料的接受度/参与度"的系统综述或成规模的实证系列。
- 仅有的新近的实验：Alghamdi & Alghizzi (2026) "Proficiency-Calibrated AI-Generated Reading Input in EFL", *Education Sciences*, 16(7), 1068（13 周干预；按 CEFR 校准的 AI 文本组在理解与态度上有提升）。（[MDPI 页面](https://www.mdpi.com/2227-7102/16/7/1068)；[Semantic Scholar 题录](https://www.semanticscholar.org/paper/995d408e943eecfdb2a4a072fcb4430a6b6b5e6c)）——**单一研究、单一场景，且比较的是"校准 AI 文本 vs 传统路径"，不是"AI 文本 vs 用户自选真实内容"。**
- 判定：设计应把 AI 生成/改写定位为**桥接材料**（把真实内容难度校准到用户可达范围、或让目标块复现），而非替代真实内容；"AI 生成文章用户不爱看"目前是合理假设而非已证事实，建议自己做 A/B 验证。

### 4.6 可行的复习设计选项清单（按证据强度排序）

| # | 设计选项 | 证据强度 | 依据 |
|---|---|---|---|
| 1 | **复习=主动回忆（先遮答案强制产出/回忆，再看反馈），绝不做成"看一遍翻卡"** | ★★★★★ | Karpicke & Roediger 2008（外语词汇材料！）；Dunlosky 2013 高效用评级 |
| 2 | **间隔调度**（到期再复习；不要求每日打卡，按记忆模型排程） | ★★★★★ | Dunlosky 2013；Cepeda et al. 2006；Nakata & Elgort 2021（语境化词汇） |
| 3 | **让目标块在后续推送内容中"自然复现"**（窄主题/同作者/同系列优先推送） | ★★★☆ | Krashen 2004 + Kang 2015 + Chang & Renandya 2021；附带习得元分析给的复现必要性 |
| 4 | **"预教→回读原文"的闭环当作一次大型提取练习**：在原文里高亮已学块，让用户自评"读得顺不顺" | ★★★☆ | Pellicer-Sánchez 2022 + 测试效应外推；闭环本身未验证（★ 减半） |
| 5 | **生成效应**：让用户用目标块造句/补全/选择语境，而非只认出释义 | ★★★☆ | Bjork & Kroll 2015；Bjork & Bjork 2011 |
| 6 | **游戏化留存层**（streak、XP）作为"服药提醒"，不作为学习机制本身 | ★★☆ | Sailer & Homner 2020（g=.25–.36）；Hamari 2014（新颖性衰减）；Duolingo 工程实践（非同行评议） |
| 7 | **交错练习**（混排不同块/话题） | ★★☆ | Bjork 框架内成立，但词汇学习中有语义集干扰的反面证据（Waring 1997），词汇领域证据混合 |
| 8 | **AI 改写原文使目标块复现并校准难度** | ★☆ | 仅单研究 + 理论外推，需自行验证 |

---

## 5. 产品先例对照表（官方来源）

| 产品 | 内容导入 | 词汇/语块提取 | 预教 | 复习 | 官方方法论自述 |
|---|---|---|---|---|---|
| **LingQ** | 极强：任意内容（Netflix/播客/文章/YouTube/TikTok…）导入或选库内课程；AI 生成转写/翻译/音频 | 阅读中点击生词存为 "LingQ"，自动高亮未知词 | ❌ 无预教环节；主张直接在语境中学 | LingQ 列表 + 复习活动（flashcard/cloze），统计追踪 | "No grammar drills, just content you enjoy"；明确以 Krashen 输入假说+Kaufmann 方法为旗（[lingq.com](https://www.lingq.com/en/)） |
| **Readlang** | 上传文本/网页 + Web Reader 插件 | 点击翻译单词或短语（免费版短语限 6 词），自动保存 | ❌ | 保存的词自动进 SRS flashcards；AI 上下文解释 | "Learn a language reading what you love"（[readlang.com](https://readlang.com/)） |
| **Language Reactor** | Netflix/YouTube 原生内容 + 导入文本/书籍 | 双语字幕 + 弹窗词典，保存词/句进 Library | ❌ | PhrasePump 复习；可导出 Anki | "discover, understand, and learn from native materials"（[Chrome Web Store 官方描述](https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm)） |
| **Dreaming Spanish** | ❌ 不导入；官方提供按难度（1–100 分）分级的 7500+ 视频 | ❌ 刻意不做词汇提取 | ❌ 明确反对（"不背词、不学语法"） | ❌ 无复习系统；以"观看小时数"为进度 | 纯可理解输入方法，自承源自 Krashen（[dreamingspanish.com/method](https://www.dreamingspanish.com/method)） |
| **Refold / Migaku** | Migaku 扩展把 Netflix/YouTube/任意网页变教材 | 一键制卡：词+语境句+音频+截图+AI 解释；**官方卡组先预载 1K 高频词** | ⚠️ 部分：用预制高频词卡组"打地基"后再浸没（Step 1 → Step 2） | 内建 SRS；**给内容算"理解度得分"帮助选下一篇**（最接近"覆盖率匹配"） | 浸没法路线图：先建词汇地基→真实内容浸没→SRS 保持（[migaku.com](https://migaku.com/)；[refold.la/roadmap](https://refold.la/roadmap)） |
| **Duolingo / Duolingo Max** | ❌ 封闭课程内容（Story/Podcast 为辅） | ❌ 课程内置词表 | ❌ | 内建间隔重复（HLR 模型，有 ACL 论文）+ streak/XP 游戏化留存 | Max 增加 GPT-4 功能：Explain My Answer、Roleplay、Video Call with Lily（[官方博客](https://blog.duolingo.com/duolingo-max/)；[效能研究页](https://www.duolingo.com/efficacy)） |

**关键观察**：

1. **没有主流产品把"先预教该内容里的块，再让用户回到该内容"做成核心环路**。LingQ/Readlang/LR 是"边读边存词"；Dreaming Spanish 拒绝显式词汇教学；Refold/Migaku 的"预教"是通用高频词（非用户内容特定）+ 内容的理解度匹配。**你的玩法 = LingQ 的导入 + Migaku 的覆盖率匹配 + 一个谁都没做的"内容特定预教"前置环节。**
2. 复习环节的行业答案高度一致：点选保存 → SRS（可导出 Anki）。证据（§4.3）显示这条路"有效但苦"——差异化机会在**把复习藏回内容复现里**（选项 3/4）。
3. 官方自述的方法论全部锚定 Krashen 输入假说；§2.5 提醒：这是营销上好用、学术上只能算"必要不充分"的支点。

---

## 6. 关于"完整闭环"的已发表先例

未找到与"用户自选内容 → 提取语块 → 预教 → 回到原内容"完全同构的已发表研究或产品白皮书。最接近的学术先例：

- **REAP（REAder-specific Practice，CMU）**：Heilman, Collins-Thompson, Callan & Eskenazi (2006)：智能导师**根据学习者的词汇目标，从网络上自动检索包含目标词且难度合适的真实文档**供其阅读，课堂部署显示学生达到与传统课程相当/更好的词汇与阅读收益。 *Interspeech 2006*.（[论文 PDF](https://www.cs.cmu.edu/~callan/Papers/interspeech06-mheilman.pdf)；[ACL Anthology 相关](https://aclanthology.org/W08-0910.pdf)）——注意方向相反（词→找文），但证明了"用词表驱动真实内容检索"这条链路的可行性。
- 词汇支持"读前/读中/读后"三种时序都有效（[Suzuki, Nakata & Rogers 2023](https://yuichisuzuki.net/wp-content/uploads/2023/09/Suzuki-Nakata-Rogers-2023-Chapter2-postprint.pdf)），说明闭环各环节的顺序有容错空间。
- 产品层面，LingQ（内容内提取+复习）、Migaku（预制词库预教+内容理解度匹配+SRS）各实现了闭环的一部分，但均无公开的受控效能研究。

**结论：闭环本身是产品级创新点，实证责任在产品方（建议内建 A/B 与学习日志研究）。**

---

## 7. 参考文献汇总

### 语块
- Wray, A. (2002). *Formulaic Language and the Lexicon*. CUP.（定义见 [PMC10914984 转引](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10914984/)）
- Conklin, K., & Schmitt, N. (2008). Formulaic sequences: Are they processed more quickly…? *Applied Linguistics*, 29(1), 72–89. https://doi.org/10.1093/applin/amm022
- Boers, F., Eyckmans, J., Kappel, J., Stengers, H., & Demecheleer, M. (2006). Formulaic sequences and perceived oral proficiency. *Language Teaching Research*, 10(3), 245–261. https://doi.org/10.1191/1362168806lr195oa
- Boers, F., & Lindstromberg, S. (2012). Experimental and intervention studies on formulaic sequences in a second language. *ARAL*, 32, 83–110. https://doi.org/10.1017/S0267190512000050
- Tavakoli, P., & Uchihara, T. (2020). To what extent are multiword sequences associated with oral fluency? *Language Learning*, 70(2), 506–547. https://doi.org/10.1111/lang.12384
- Lewis, M. (1993). *The Lexical Approach*. LTP.（教学流派著作）

### 预教与覆盖率
- Pellicer-Sánchez, A., et al. (2022). The effect of pre-reading instruction on vocabulary learning: An investigation of L1 and L2 readers' eye movements. *Language Learning*. https://doi.org/10.1111/lang.12430
- Pujadas, G., & Muñoz, C. (2019). Extensive viewing of captioned and subtitled TV series: a study of L2 vocabulary learning by adolescents. *Modern Language Journal*, 73(2). https://diposit.ub.edu/bitstreams/85fa41f1-0cf8-4930-a94c-d1fe8d29646d/download
- Stahl, S. A., & Fairbanks, M. M. (1986). The effects of vocabulary instruction: A model-based meta-analysis. *RRQ*, 21(1), 72–110. https://lincs.ed.gov/publications/archive/chapter2.pdf
- Nation, I. S. P. (2006). How large a vocabulary is needed for reading and listening? *CMLR*, 63(1), 59–82. https://doi.org/10.3138/cmlr.63.1.59
- Hu, M., & Nation, I. S. P. (2000). Unknown vocabulary density and reading comprehension. *RFL*, 13(1), 403–430.
- Schmitt, N., Jiang, X., & Grabe, W. (2011). The percentage of words known in a text and reading comprehension. *MLJ*, 95(1), 26–43. https://doi.org/10.1111/j.1540-4781.2011.01146.x
- Laufer, B., & Ravenhorst-Kalovski, G. C. (2010). Lexical threshold revisited. *SSLA*, 32(1).
- Kremmel, B., Indrarathne, B., Kormos, J., & Suzuki, S. (2023). Unknown vocabulary density and reading comprehension: Replicating Hu and Nation (2000). *Language Learning*, 73(4), 1127–1163. https://doi.org/10.1111/lang.12622
- Durbahn, M., Rodgers, M., Macis, M., & Peters, E. (2024). Lexical coverage in L1 and L2 viewing comprehension. *SSLA*, 46(4), 1045–1068. https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/lexical-coverage-in-l1-and-l2-viewing-comprehension/DFCA6605076705D5762C98F286D16B27
- van Zeeland, H., & Schmitt, N. (2013). Incidental vocabulary acquisition through L2 listening. *System*, 41, 609–624. https://doi.org/10.1016/j.system.2013.07.012

### 兴趣与动机
- Schiefele, U. (1999). Interest and learning from text. *Scientific Studies of Reading*, 3(3), 257–279. https://doi.org/10.1207/s1532799xssr0303_4
- Schiefele, U., Krapp, A., & Winteler, A. (1992). Interest as a predictor of academic achievement: A meta-analysis. In *The Role of Interest in Learning and Development* (pp. 183–212). Erlbaum.
- Hidi, S., & Renninger, K. A. (2006). The four-phase model of interest development. *Educational Psychologist*, 41(2), 111–127. https://doi.org/10.1207/s15326985ep4102_2
- Lee, S., & Pulido, D. (2017). The impact of topic interest, L2 proficiency, and gender on EFL incidental vocabulary acquisition through reading. *LTR*, 21(1), 118–135. https://eric.ed.gov/?id=EJ1124471
- Topic interest increases L2 incidental vocabulary learning and effective dictionary look-up behaviour (2023). *Learning and Motivation*. https://doi.org/10.1016/j.lmot.2023.101920
- Alamer, A., et al. (2025). Self-Determination Theory and Language Learning: A Multilevel Meta-Analysis. https://selfdeterminationtheory.org/wp-content/uploads/2025/06/2025_AlamerRobatEtAl_L2.pdf
- Al-Hoorie, A. H. (2018). The L2 Motivational Self System: A meta-analysis. *SSLLT*, 8(4), 721–754. https://doi.org/10.14746/ssllt.2018.8.4.2
- 真实材料动机： https://doi.org/10.1080/10573569.2021.1892001 ；对照（差异不显著）： https://doi.org/10.1515/cjal-2013-0029

### 复习机制
- Karpicke, J. D., & Roediger, H. L. (2008). The critical importance of retrieval for learning. *Science*, 319, 966–968. https://doi.org/10.1126/science.1152408
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning. *Psychological Science*, 17(3), 249–255. https://doi.org/10.1111/j.1467-9280.2006.01693.x
- Dunlosky, J., et al. (2013). Improving students' learning with effective learning techniques. *PSPI*, 14(1), 4–58. https://doi.org/10.1177/1529100612453266
- Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way. https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf
- Bjork, R. A., & Kroll, J. F. (2015). Desirable difficulties in vocabulary learning. *American Journal of Psychology*, 128(2), 241–252.
- Nakata, T., & Elgort, I. (2021). Effects of spacing on contextual vocabulary learning. *Second Language Research*, 37(4), 687–711.
- Seibert Hanson, A. E., & Brown, C. M. (2020). Enhancing L2 learning through a mobile assisted spaced-repetition tool: an effective but bitter pill? *CALL*, 33(1–2), 133–155. https://doi.org/10.1080/09588221.2018.1552975
- Gilbert, M. M., et al. (2023). Anki in medical school. https://pmc.ncbi.nlm.nih.gov/articles/PMC10403443/
- Sailer, M., & Homner, L. (2020). The gamification of learning: A meta-analysis. *Educ. Psych. Review*, 32, 77–112. https://doi.org/10.1007/s10648-019-09498-w
- Hamari, J., Koivisto, J., & Sarsa, H. (2014). Does gamification work? https://doi.org/10.1109/HICSS.2014.377
- Vesselinov, R., & Grego, J. (2012). Duolingo effectiveness study.（公司委托报告，未同行评议）
- Jiang, X., Rollinson, J., Plonsky, L., Gustafson, E., & Pajak, B. (2021). Evaluating the reading and listening outcomes of beginning-level Duolingo courses. *Foreign Language Annals*, 54(4), 974–1002. https://www.duolingo.com/efficacy/studies
- Settles, B., & Meeder, B. (2016). A trainable spaced repetition model for language learning. *ACL*. https://aclanthology.org/P16-1174/

### 窄读与附带习得
- Krashen, S. (2004). The case for narrow reading. *Language Magazine*, 3(5), 17–19. http://www.sdkrashen.com/content/articles/narrow.pdf
- Schmitt, N., & Carter, R. (2000). The lexical advantages of narrow reading. *TESOL Journal*, 9(1), 4–9. https://doi.org/10.1002/j.1949-3533.2000.tb00220.x
- Kang, E. Y. (2015). Promoting L2 vocabulary learning through narrow reading. *RELC Journal*, 46(2), 165–179. https://doi.org/10.1177/0033688215586236
- Chang, A. C.-S., & Renandya, W. A. (2021). The effect of narrow reading on L2 learners' vocabulary acquisition. *RELC Journal*, 52(3), 493–508. https://doi.org/10.1177/0033688219871387
- Webb, S., Uchihara, T., & Yanagisawa, A. (2023). How effective is second language incidental vocabulary learning? A meta-analysis. *Language Teaching*, 56. https://doi.org/10.1017/S0261444822000507
- Waring, R., & Takaki, M. (2003). At what rate do learners learn and retain new vocabulary from reading a graded reader? *RFL*, 15(2), 130–163. https://doi.org/10.64152/10125/66776
- Horst, M. (2005). Learning L2 vocabulary through extensive reading: A measurement study. *CMLR*, 61(3), 355–382. https://doi.org/10.3138/cmlr.61.3.355
- Nakanishi, T. (2015). A meta-analysis of extensive reading research. *TESOL Quarterly*, 49(1), 6–37. https://doi.org/10.1002/tesq.157
- Sangers, N. L., et al. (2025). Learning a language through reading: A meta-analysis. *Educ. Psych. Review*, 37, 96. https://doi.org/10.1007/s10648-025-10068-6

### Krashen 批评与 AI 材料
- Krashen 输入假说神经生态学批评（2025）： https://pmc.ncbi.nlm.nih.gov/articles/PMC12577063/
- Alghamdi, L. H., & Alghizzi, T. M. (2026). Proficiency-calibrated AI-generated reading input in EFL. *Education Sciences*, 16(7), 1068. https://www.mdpi.com/2227-7102/16/7/1068
- REAP： Heilman, M., Collins-Thompson, K., Callan, J., & Eskenazi, M. (2006). Classroom success of an intelligent tutoring system for lexical practice and reading comprehension. *Interspeech 2006*. https://www.cs.cmu.edu/~callan/Papers/interspeech06-mheilman.pdf

### 产品官方来源
- LingQ: https://www.lingq.com/en/
- Readlang: https://readlang.com/
- Language Reactor: https://chromewebstore.google.com/detail/language-reactor/hoombieeljmmljlkjmnheibnpciblicm
- Dreaming Spanish: https://www.dreamingspanish.com/method
- Refold: https://refold.la/roadmap
- Migaku: https://migaku.com/
- Duolingo 效能页: https://www.duolingo.com/efficacy ；Duolingo Max: https://blog.duolingo.com/duolingo-max/

---

## 附录：未能核实 / 不确定项

1. **完整闭环无直接证据**：未找到"用户自选内容 → 提取块 → 预教 → 回读"的已发表端到端研究；REAP（词→找文）是最近先例。
2. **Lewis 的 Lexical Approach 无体系级 RCT**：其"流派"地位成立；"按 Lexical Approach 教学更优"的严格对照证据未找到，支持均来自语块研究的间接外推。
3. **Karpicke & Roediger (2008) 的具体百分比**（~80% vs ~33–36%）来自对该文结果的通行转述（多个二手来源一致），未逐字核对原文表格。
4. **Waring & Takaki (2003) 的精确数字**（各频段的习得/保持百分比）未从全文核对；ERIC 摘要级结论（"多数词未学会；10+ 次出现最好；3 个月显著衰减"）可靠。
5. **Duolingo 数据的公司利益冲突**：Vesselinov & Grego 2012 未经同行评议且样本自选；Jiang et al. 2021 虽发表于同行评议期刊但作者含 Duolingo 员工；口语/写作维度效能基本未测。
6. **"AI 生成文章用户不爱看"无实证**：唯一的对照类研究（Alghamdi & Alghizzi 2026）结果方向相反，但为单一研究、未独立复制，MDPI 页面有反爬未读到全文。
7. **Seibert Hanson & Brown 的"70→20 人"数字**转引自 RWTH 一篇学位论文对该研究的转述，未在其原文逐字核对；该研究"依从性差异大、随时间下降、剂量-效应正相关"的主结论可靠（标题与摘要可证）。
8. **游戏化效果的外推**：Sailer & Homner 2020 的 g 值来自正规教育场景居多，对成人自主语言学习 app 的可迁移性不确定；新颖性衰减是文献综述级判断（Hamari 2014），缺长期纵向 RCT。
9. **Boers et al. (2006) 未给出可核对的效果量**（小规模实验，报告显著性），本报告仅作定性引用。
10. **兴趣研究的 L2 外推**：Schiefele 系列为 L1（德语）语境；L2 专属证据（Lee & Pulido 2017 等）为单项研究级别，方向一致但量级未做 L2 元分析。
