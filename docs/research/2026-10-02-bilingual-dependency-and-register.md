# 双语依赖与语域风险：语言学习 Agent 聊天功能的学术证据调研

- 日期：2026-10-02
- 范围：二语习得（SLA）、计算机中介交流（CMC）、语用学一手文献
- 共识等级标注：**高** = 综述/多研究一致；**中** = 有实证但情境受限或间接；**低/缺口** = 无直接实证

---

## 1. TL;DR

**担忧 (1) 双语依赖 —— 半真风险。**
"对方懂我母语 → 学习者逃避目标语输出"有坚实的心理机制基础（最小努力原则、回避策略）和大量间接证据（教师 L1 使用与学生目标语产出负相关；tandem 伙伴难以维持目标语纪律），但**没有任何针对"AI 角色会不会母语"这一变量的直接实验**。同时，SLA 界 20 年来的共识**不是**"禁用母语"，而是"最大化目标语 + 策略性使用母语"（Turnbull & Dailey-O'Cain 2009；Macaro 2001）。真正的风险不在角色"会"母语，而在**学习者可以无成本地用母语完成交际目标**。

→ 设计判定：角色"会母语但按需使用 + 系统层面逼出目标语输出"优于"完全不会"或"装作不懂"。详见 §3 三策略表。

**担忧 (2) 网络用语/非正式语域 —— 基本是假担忧。**
- 二语研究中学习者语域失误的**已知主要形态是"过于正式、像教科书"，而不是"过于俚俗"**（Dewaele 2004；Regan, Howard & Lemée 2009）——原因是课堂输入缺少非正式语域。
- "先接触非正式语域是否有害"：**无任何输入顺序的直接实证**（证据缺口）；母语者短信语（textese）研究的主流结论是**对读写能力无害甚至正相关**（Wood, Kemp & Plester 2014；van Dijk et al. 2016），仅儿童"短信中不合语法用法"与语法发展有混合/负相关的纵向证据（Wood, Kemp & Waldron 2014）。
- 网聊交互本身能发展语用/社会语言能力（Belz & Kinginger 2002，称呼形式习得）。
- CEFR 已有现成的"社会语言得体性（sociolinguistic appropriateness）"分级量表可直接用作语域标注依据（CEFR 2001/2020）。

→ 设计判定：不必屏蔽网络用语；应做**语域标注 + 显式语域教学**（Lyster 1994 证明显式教学有效），并保证输入语域多样而非单一非正式。

---

## 2. A. 母语使用与输出逃避 —— 证据地图

### A1. L1 使用之争的当前共识（共识等级：高）

- **Turnbull & Dailey-O'Cain (2009)** 主编的专题论文集是这一争论的里程碑。其结论章（"Concluding reflections: moving forward"）明确：**没有实证证据支持"绝对排斥 L1"的教学更优**；证据支持的是"最大化目标语使用 + 审慎（judicious）、有原则地使用 L1"。两派分歧已从"用不用"转向"用多少、何时用"。DOI: 10.21832/9781847691972
- **Macaro (2001)** 对实习教师课堂语码转换的分析提出教师 L1 使用的决策框架：L1 可用于降低认知负荷、管理课堂、建立关系，但教师 L1 使用量与学生接触目标语的量存在此消彼长。DOI: 10.1111/0026-7902.00124；另见 Macaro (2009) 章节"Teacher use of codeswitching in the second language classroom"（DOI: 10.2307/jj.29308487.7）
- **Turnbull & Arnett (2002)** 的综述：教师目标语使用与学生目标语接触/产出正相关，故主张"maximize TL"，但不主张绝对排斥 L1。DOI: 10.1017/S0267190502000119
- **Turnbull (2001)**："There is a role for the L1 in second and foreign language teaching, but…" CMLR 57(4)。DOI: 10.3138/cmlr.57.4.531
- **学生态度**：Rolin-Ianziti & Varshney (2008) 调查大学生对教师 L1 使用的看法，学生接受"有限、功能性"的 L1 使用，反感的是教师**过度**使用 L1 挤占目标语。DOI: 10.3138/cmlr.65.2.249
- **Levine (2003)**：TL 使用量与学习者焦虑并非简单正相关——报告更多目标语使用的班级学生焦虑反而更低，提示"纯目标语"与"焦虑"的关系比直觉复杂。DOI: 10.1111/1540-4781.00194

**一句话共识**：默认目标语、把 L1 当作有原则、渐退的脚手架；没有人再为"L1 零容忍"提供实证辩护，也没有人主张放任 L1。

### A2. 直接证据：对象懂母语时，学习者目标语产出是否下降？（共识等级：中 —— 间接证据一致，直接实验缺失）

没有以"交流对象是否懂学习者 L1"为自变量的对照实验（无论真人还是 AI 聊天机器人——这是明确的研究缺口）。支持性间接证据：

- **Tandem / eTandem（双语互助）**：tandem 的两个核心原则是自主性与互惠性（双方各占约一半时间使用自己的目标语）。实证记录到的主要失败模式正是**目标语纪律难以维持、会话滑向更强/更省力的共同语言**：
  - O'Rourke (2005) 对在线 tandem 会话的分析：focus-on-form 互动确实发生，但语言选择与纪律依赖参与者自觉。DOI: 10.1558/cj.v22i3.433-466
  - Bower & Kawaguchi (2011) 日英 eTandem：意义协商与纠错的量低于师生/生生任务式交互的预期，作者将其部分归因于学习者回避纠错、优先维持融洽。DOI: 10.64152/10125/44237（开放获取）
  - Kabata & Edasawa (2011) 日加 keypal 项目：互惠原则下学习者产出模式高度不均，需要教师结构化干预才能维持目标语使用。DOI: 10.64152/10125/44239（开放获取）
  - O'Dowd & O'Rourke (2019) 对 tandem/虚拟交换 20 年的综述将"语言使用失衡"列为该模式的慢性问题。DOI: 10.64152/10125/44690（开放获取）
- **同母语二人组中的 L1**：Swain & Lapkin (2000) 发现共享 L1 的学习者二人组完成任务时自然用 L1 做任务管理——说明"L1 可用就会被用"是默认行为，尤其在元话语层面。DOI: 10.1177/136216880000400304（注意：他们同时证明这种 L1 使用有学习功能，故问题不在"用"，在"失控地用"）
- **教师端相关证据**（A1）：教师 L1 用得越多，学生目标语暴露/产出越少（Turnbull & Arnett 2002）。

**Translanguaging 的证据边界（区分政治主张与实证）**：
- García & Li Wei (2014, DOI: 10.1057/9781137385765) 的 translanguaging 主张双语者语言资源一体、教学应允许自由调动——其解放性/身份政治论证强，但"translanguaging 教学优于结构化目标语教学"的**学习成效因果证据薄弱**。
- MacSwan (2017) 从语言学角度批评：translanguaging 的经验现象（语码转换）已有成熟研究覆盖，其作为独立构念缺乏可证伪的增量解释力。DOI: 10.3102/0002831216683935
- Jaspers (2018) 批评其"变革性"承诺超出实证支持。DOI: 10.1016/j.langcom.2017.12.001
- 对本产品的含义：translanguaging 文献可用来为"不污名化 L1 使用"提供正当性，但**不能**作为"放任双语混用无害于目标语产出"的实证依据。

### A3. 什么机制能"逼"出目标语产出（共识等级：中-高）

Swain 的输出假说：产出（尤其"被推出来的产出" pushed output）驱动注意差距、假设检验、自动化。核心文献：Swain (1993) DOI: 10.3138/cmlr.50.1.158；Swain & Lapkin (1995) DOI: 10.1093/applin/16.3.371。

互动手段诱发产出的实证：

- **澄清请求（clarification request）是最有效的"逼输出"手段**：
  - Pica, Holliday, Lewis & Morgenthaler (1989)：对学习者产出的澄清/确认要求导致学习者**修改自己的输出**（comprehensible output）。DOI: 10.1017/S027226310000783X
  - Nobuyoshi & Ellis (1993)：对低水平学习者使用聚焦式澄清请求，推动其产出更准确的目标形式。DOI: 10.1093/elt/47.3.203
  - de la Fuente (2002)：协商互动（含 pushed output）促成词汇习得，效果不低于（甚至优于）预教输入。DOI: 10.1017/S0272263102001043
- 文字聊天环境同样成立：Lai & Zhao (2006) 证明 text-based chat 中的重铸可被学习者注意到——在线聊天是合法的 FonF（focus on form）场域。DOI: 10.64152/10125/44077（开放获取）
- Shehadeh (2002)：从"出现可理解输出"到"习得"之间的研究议程——提示仅有产出不够，需配合反馈。DOI: 10.1111/1467-9922.00196

### A4. 三种角色策略对比

| 策略 | 实证依据 | 风险 | 判定 |
|---|---|---|---|
| **S1 角色完全不会用户母语** | 强制必要性最大化 pushed output（A3 机制的前提）；与"最大化 TL"共识一致 | 初学者交际崩溃、焦虑上升（Levine 2003 提示关系复杂但初学者阈值真实存在）；违背 A1 共识"策略性 L1 有价值"；无法解释词语/澄清歧义 | 适合 B1+；A1–A2 风险高 |
| **S2 会但装作不懂** | **无任何研究**（证据缺口）；欺骗被识破后的信任/动机后果无人研究 | 一旦被识破（用户用母语试探角色反应）即穿帮；语用上不自然（真人语伴做不到）；可能制造"对方听不懂"的假反馈，扭曲协商信号 | 不建议作为默认；如采用需显式告知"游戏规则" |
| **S3 会且按需使用（推荐）** | 与 A1 共识（judicious L1）直接对应；tandem 失败模式（A2）可用产品机制对冲；脚手架渐退有支架教学研究支持（van de Pol, Volman & Beishuizen 2010 综述，DOI: 10.1007/s10648-010-9127-6：有效支架含"渐退" fading 要素） | 学习者滥用母语通道（A2 的回避机制）——**必须用机制而非人设来约束** | 见下方机制清单 |

**S3 的关键配套机制（每条都有 A3 文献支撑）**：
1. **L1 闸门**：角色的母语回复只用于元交际（解释、确认理解、救场），且优先用目标语释义 + 母语兜底，而非直接用母语继续话题。
2. **主动逼输出**：角色对含糊/母语输入发出澄清请求（"你是想说 X 吗？用[目标语]试试"）——Pica et al. 1989; Nobuyoshi & Ellis 1993。
3. **产出要求前置**：任务设计上让目标必须由目标语产出达成（de la Fuente 2002 的协商逻辑）。
4. **分阶段降低 L1 支架（graded L1 withdrawal）**：直接的"渐退式 L1"语言教学实验**不存在**（证据缺口）；但有 (a) 教师 L1 使用随学生水平上升而下降的观察性证据（Macaro 2001; Turnbull & Arnett 2002），(b) 支架教学的渐退原则（van de Pol et al. 2010）。即按 CEFR 等级程序化地减少母语可用性（A1-A2 全量可用 → B1 仅元交际 → B2+ 仅显式请求触发）。

---

## 3. B. 语域与网络用语 —— 证据地图

### B1. 语域/语体习得实证（共识等级：中）

- **学习者语域失误的主要形态是"过于正式"而非"过于俚俗"**：
  - Dewaele (2004)：课堂法语学习者系统性地**过度使用正式变体**、缺少非正式变体；沉浸/留学经历才补足社会语言能力。DOI: 10.1017/S0959269504001814
  - Regan, Howard & Lemée (2009)《The Acquisition of Sociolinguistic Competence in a Study Abroad Context》：留学者通过接触非正式输入习得变体并渐趋得体——非正式语域输入是**必要条件**，不是污染物。DOI: 10.21832/9781847691583
- **语用失误概念框架**：Thomas (1983) 区分语用语言失误（pragmalinguistic failure）与社交语用失误（sociopragmatic failure）；语域失配属前者，由教学输入偏差直接造成。DOI: 10.1093/applin/4.2.91
- **显式语域教学有效**：Lyster (1994) 在法语沉浸课堂用功能-分析式教学显著提升学生的社会语言得体性——语域是**可教的**，标注+显式讲解比"靠接触自然悟到"快。DOI: 10.1093/applin/15.3.263

### B2. "先接触非正式语域是否有害"（共识等级：低/缺口）+ textese 母语研究（共识等级：中-高，仅限母语者）

- **输入顺序（先正式后非正式 vs 混合）对二语语域能力的影响：没有任何直接实证研究。**教科书历史上先教正式/标准语体是惯例而非实证结论。此为本调研明确的证据缺口。
- **短信语（textese）对母语者读写能力的影响——主流结论：无害或正相关**：
  - Crystal (2008)《Txting: The Gr8 Db8》（Oxford UP）：语言学家面向公众的论证——短信语是创造性文字游戏，历史恐慌无据。
  - Wood, Kemp & Plester (2014)《Text Messaging and Literacy – The Evidence》（Routledge）综合证据：儿童 textism 使用与拼写、阅读、语音意识**正相关**（相关数据为主；因果方向部分由"读写好者更擅长玩文字变体"解释）。
  - Plester, Wood & Joshi (2009)：儿童掌握短信缩写知识越多，学校读写成绩越好。DOI: 10.1348/026151008X320507
  - Kemp & Bushnell (2011)：短信读写速度与读写能力正相关。JCAL 27(1):18-27。
  - van Dijk et al. (2016)（PLOS ONE，荷兰小学儿童，纵向）：textese 使用**不损害**语法发展，且与执行功能正相关；儿童和成人都按语域切换（对老师/朋友用不同文体）。DOI: 10.1371/journal.pone.0152409
  - **唯一需要带上的警告**：Wood, Kemp & Waldron (2014) 纵向研究：儿童在短信中的"不合语法用法"（grammatical violations，如省略助动词）比例与其一年后的语法任务表现**负相关**——语法维度的证据是混合的。DOI: 10.1111/bjdp.12049
  - Tagliamonte & Denis (2008)：青少年 IM 语言不是"语言毁灭"，而是一个混合了新变体的新语域，青少年具备语域切换意识。DOI: 10.1215/00031283-2008-001
- **能否迁移到二语语境**：不能机械迁移（母语者已有完整语域直觉，切换是免费的）。但迁移方向提示：风险不在于"接触非正式变体"，而在于**只接触单一语域**且不知其适用边界。二语者已有母语语域概念（Thomas 1983 的社会语用迁移），缺的是目标语中"哪个形式配哪个场合"的映射——这恰是标注可以补的。

### B3. 非正式语域/网聊的正面价值（共识等级：中）

- Belz & Kinginger (2002)：德语/法语学习者与母语者 telecollaboration 聊天后，**称呼形式（T/V, du/Sie）使用显著向母语者规范收敛**——自由网聊交互能发展最难教的社会语用能力。DOI: 10.3138/cmlr.59.2.189
- Belz & Kinginger (2003)：课堂学习者通过与母语者的在线互动发展语用能力（discourse options）。DOI: 10.1046/j.1467-9922.2003.00238.x
- Lai & Zhao (2006)：文字聊天提供可反复回看的记录，促进 noticing。DOI: 10.64152/10125/44077
- Herring (2004) 的 CMDA（computer-mediated discourse analysis）确立了 CMC 语言作为独立语域的研究地位——网络用语是**目标语本族使用者真实语域的一部分**，不教它=教一门不存在的"纯正式语"。
- 真实性/社群融入：tandem/虚拟交换文献（O'Dowd & O'Rourke 2019）反复报告网络口语接触是动机与社群融入的主要来源。

### B4. 语域标注/控制是否可行 —— 现成分级体系（可用，无需自建）

- **CEFR 的"社会语言得体性（Sociolinguistic appropriateness）"量表**直接可用：
  - CEFR (2001) p.122；CEFR Companion Volume (2020) §5.2, pp.136–137。官方 PDF: https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4
  - 量表递进大意：A1–A2 只会礼貌套话与最简日常形式；B1 能在中性/非正式间做基本区分、知道礼貌程式；B2 能识别并初步产出语域差异；C1 能灵活得体地调整语域；C2 完全掌控。——可直接映射为产品内"角色语域解锁等级"。
- CEFR CV (2020) 另有 **Pragmatic competence** 下的 flexibility、turntaking 等描述符，可用于网聊互动行为的等级化。
- 配套证据：Lyster (1994) 证明显式语域标注/教学优于纯接触——即"标注"本身是有实证依据的教学动作，不只是工程洁癖。

**语域设计建议汇总**：
1. 不屏蔽网络用语，但**每条角色消息带语域标签**（正式/中性/非正式/网络语域），标签可见可点开解释。
2. 语域**输入混合化**：按 CEFR 得体性量表，低等级以中性+礼貌程式为主、少量高频非正式/网络变体并标注；B1+ 逐步放开（与 Dewaele 2004 的"缺非正式变体"诊断对冲）。
3. 防止**单一语域偏食**是真正的风险控制点：若用户长期只与"哥们型"角色聊天，主动推荐/轮换正式语域场景角色。
4. 利用 Lyster (1994) 的结论：语域失配用**显式、简短的元语言提示**纠正，而非隐式重铸。

---

## 4. 可用分级/教学资源清单

| 资源 | 内容 | 获取 |
|---|---|---|
| CEFR (2001) | 社会语言得体性量表 p.122；语域定义 pp.118–122 | Council of Europe，免费 PDF |
| CEFR Companion Volume (2020) | 更新版 Sociolinguistic appropriateness 描述符 pp.136–137；语用能力描述符 | https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4 |
| Turnbull & Dailey-O'Cain (2009) | L1 使用之争的权威论文集，含教师/学生双方实证章节 | DOI: 10.21832/9781847691972 |
| Levine (2011)《Code Choice in the Language Classroom》 | 有原则的双语使用框架（含具体课堂协议），可直接改写为角色行为规则 | Multilingual Matters |
| Wood, Kemp & Plester (2014)《Text Messaging and Literacy – The Evidence》 | textese 证据的权威综合 | Routledge |
| Lai & Zhao (2006)、LLT 开放获取论文 | 文字聊天教学证据（免费） | https://www.lltjournal.org（DOI: 10.64152/10125/44077 等） |

---

## 5. 参考文献汇总

**A 组（L1 使用与产出）**
1. Turnbull, M. (2001). There is a role for the L1 in second and foreign language teaching, but… *CMLR* 57(4). DOI: 10.3138/cmlr.57.4.531
2. Turnbull, M., & Arnett, K. (2002). Teachers' uses of the target and first languages in second and foreign language classrooms. *Annual Review of Applied Linguistics* 22. DOI: 10.1017/S0267190502000119
3. Macaro, E. (2001). Analysing student teachers' codeswitching in foreign language classrooms. *Modern Language Journal* 85(4). DOI: 10.1111/0026-7902.00124
4. Macaro, E. (2009). Teacher use of codeswitching in the second language classroom. In Turnbull & Dailey-O'Cain (Eds.). DOI: 10.2307/jj.29308487.7
5. Turnbull, M., & Dailey-O'Cain, J. (Eds.) (2009). *First Language Use in Second and Foreign Language Learning*. Multilingual Matters. DOI: 10.21832/9781847691972
6. Levine, G. (2003). Student and instructor beliefs and attitudes about target language use, first language use, and anxiety. *Modern Language Journal* 87(3). DOI: 10.1111/1540-4781.00194
7. Levine, G. (2011). *Code Choice in the Language Classroom*. Multilingual Matters.
8. Rolin-Ianziti, J., & Varshney, R. (2008). Students' views regarding the use of the first language. *CMLR* 65(2). DOI: 10.3138/cmlr.65.2.249
9. Swain, M. (1993). The output hypothesis: Just speaking and writing aren't enough. *CMLR* 50(1). DOI: 10.3138/cmlr.50.1.158
10. Swain, M., & Lapkin, S. (1995). Problems in output and the cognitive processes they generate. *Applied Linguistics* 16(3). DOI: 10.1093/applin/16.3.371
11. Swain, M., & Lapkin, S. (2000). Task-based second language learning: The uses of the first language. *Language Teaching Research* 4(3). DOI: 10.1177/136216880000400304
12. Pica, T., Holliday, L., Lewis, N., & Morgenthaler, L. (1989). Comprehensible output as an outcome of linguistic demands on the learner. *SSLA* 11(1). DOI: 10.1017/S027226310000783X
13. Nobuyoshi, J., & Ellis, R. (1993). Focused communication tasks and second language acquisition. *ELT Journal* 47(3). DOI: 10.1093/elt/47.3.203
14. de la Fuente, M. J. (2002). Negotiation and oral acquisition of L2 vocabulary. *SSLA* 24(1). DOI: 10.1017/S0272263102001043
15. Shehadeh, A. (2002). Comprehensible output, from occurrence to acquisition. *Language Learning* 52(3). DOI: 10.1111/1467-9922.00196
16. Lai, C., & Zhao, Y. (2006). Noticing and text-based chat. *Language Learning & Technology* 10(3). DOI: 10.64152/10125/44077
17. O'Rourke, B. (2005). Form-focused interaction in online tandem learning. *CALICO Journal* 22(3). DOI: 10.1558/cj.v22i3.433-466
18. Bower, J., & Kawaguchi, S. (2011). Negotiation of meaning and corrective feedback in Japanese/English eTandem. *Language Learning & Technology* 15(1). DOI: 10.64152/10125/44237
19. Kabata, K., & Edasawa, Y. (2011). Tandem language learning through a cross-cultural keypal project. *Language Learning & Technology* 15(1). DOI: 10.64152/10125/44239
20. O'Dowd, R., & O'Rourke, B. (2019). New developments in virtual exchange in foreign language education. *Language Learning & Technology* 23(3). DOI: 10.64152/10125/44690
21. García, O., & Li Wei (2014). *Translanguaging: Language, Bilingualism and Education*. Palgrave. DOI: 10.1057/9781137385765
22. MacSwan, J. (2017). A multilingual perspective on translanguaging. *American Educational Research Journal* 54(1). DOI: 10.3102/0002831216683935
23. Jaspers, J. (2018). The transformative limits of translanguaging. *Language & Communication* 58. DOI: 10.1016/j.langcom.2017.12.001
24. van de Pol, J., Volman, M., & Beishuizen, J. (2010). Scaffolding in teacher–student interaction: A decade of research. *Educational Psychology Review* 22. DOI: 10.1007/s10648-010-9127-6

**B 组（语域与网络用语）**
25. Thomas, J. (1983). Cross-cultural pragmatic failure. *Applied Linguistics* 4(2). DOI: 10.1093/applin/4.2.91
26. Lyster, R. (1994). The effect of functional-analytic teaching on aspects of French immersion students' sociolinguistic competence. *Applied Linguistics* 15(3). DOI: 10.1093/applin/15.3.263
27. Dewaele, J.-M. (2004). The acquisition of sociolinguistic competence in French as a foreign language: An overview. *Journal of French Language Studies* 14(3). DOI: 10.1017/S0959269504001814
28. Regan, V., Howard, M., & Lemée, I. (2009). *The Acquisition of Sociolinguistic Competence in a Study Abroad Context*. Multilingual Matters. DOI: 10.21832/9781847691583
29. Crystal, D. (2008). *Txting: The Gr8 Db8*. Oxford University Press.
30. Plester, B., Wood, C., & Joshi, P. (2009). Exploring the relationship between children's knowledge of text message abbreviations and school literacy outcomes. *British Journal of Developmental Psychology* 27(1). DOI: 10.1348/026151008X320507
31. Kemp, N., & Bushnell, C. (2011). Children's text messaging: Abbreviations, input methods and links with literacy. *Journal of Computer Assisted Learning* 27(1).
32. Wood, C., Kemp, N., & Waldron, S. (2014). Exploring the longitudinal relationships between the use of grammar in text messaging and performance on grammatical tasks. *British Journal of Developmental Psychology* 32(4). DOI: 10.1111/bjdp.12049
33. Wood, C., Kemp, N., & Plester, B. (2014). *Text Messaging and Literacy – The Evidence*. Routledge.
34. van Dijk, C. N., et al. (2016). The influence of texting language on grammar and executive functions in primary school children. *PLOS ONE* 11(3). DOI: 10.1371/journal.pone.0152409
35. Tagliamonte, S. A., & Denis, D. (2008). Linguistic ruin? LOL! Instant messaging and teen language. *American Speech* 83(1). DOI: 10.1215/00031283-2008-001
36. Belz, J. A., & Kinginger, C. (2002). The cross-linguistic development of address form use in telecollaborative language learning. *CMLR* 59(2). DOI: 10.3138/cmlr.59.2.189
37. Belz, J. A., & Kinginger, C. (2003). Discourse options and the development of pragmatic competence by classroom learners of German. *Language Learning* 53(4). DOI: 10.1046/j.1467-9922.2003.00238.x
38. Council of Europe (2001/2020). *Common European Framework of Reference for Languages*（Companion Volume）. https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4

---

## 6. 附录：不确定项与研究缺口

1. **最大缺口**：没有以"AI/交流对象是否懂学习者母语"为自变量、以目标语产出量为因变量的实验。S1/S2/S3 三策略的选择是从教师端、tandem、输出假说三条证据线外推的。
2. **"装作不懂"（S2）完全无研究**：欺骗性语伴的信任与动机后果在 SLA 和人机交互文献中都缺位；若采用，需自行做用户测试。
3. **graded L1 withdrawal（分阶段降低 L1 支架）无直接语言教学实验**；渐退原则来自通用支架教学综述（van de Pol et al. 2010）+ 教师 L1 随水平下降的观察。
4. **语域输入顺序（先正式 vs 混合）无实证**：本文"混合输入+标注"的建议是从 Dewaele (2004) 的缺失诊断 + Lyster (1994) 的显式教学证据间接推出的，不是顺序实验的结论。
5. textese 证据几乎全部来自**母语儿童/成人**，向二语成人的迁移是推断；且语法维度有纵向负相关信号（Wood, Kemp & Waldron 2014），故"网络用语"应限定为**语域/拼写变体**，角色自身语法必须保持规范。
6. tandem 文献中"语言滑向强势共同语"多为质性观察，量化程度有限。
7. Levine (2003) 的 TL-焦虑负相关为自我报告数据，因果方向不明。
