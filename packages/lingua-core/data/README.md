# 知识条目种子库（data/）

`knowledge-entries.json`：30 条手工种子知识条目（issue #12，ADR-0005），
是 agent 一切语言讲解的唯一合法来源。三类各 10 条：

- **中英思维差异**（10）：以 Slobin 的 thinking for speaking 框架表述（“该语言的语法
  逼你说话时注意什么”），不用决定论语气；「形合/意合」类表述一律标注为**教学性概括**，
  并置“话题突出 vs 主语突出”框架；已证伪材料（如“中文垂直时间思维”）仅以**有争议**
  等级作为反例条目存在。
- **高频语法**（10）：以 English Grammar Profile（EGP）的 CEFR 实证分级为锚。
- **语用语域**（10）：以 CEFR Companion Volume (2020) 社会语言得体性量表为锚。

## 生产与校验程序

每条目按以下流程产生（ADR-0005：AI 起草 → 一手来源校验）：

1. AI 起草三层内容（例句+一句直觉规律 / 展开 / 术语与理论）。
2. 对照一手来源校验事实性宣称：WALS（wals.info，CC BY 4.0）类型学特征值、
   English Grammar Profile（englishprofile.org）级别归属、
   CEFR Companion Volume (2020) 得体性量表（Council of Europe）。
3. 标注证据等级：**学界共识**（类型学/描写语法事实、有元分析或一致文献支持）/
   **教学性概括**（对比语言学传统、语料倾向性描述，有用但非定律）/
   **有争议**（复制失败或方法学受质疑的说法，仅作反例教学）。
4. 引注只给书目与特征锚（cite, don't pirate），不转载来源大段文字。

## 许可

本目录内容为**内容**而非代码：CC BY 4.0（仓库根 LICENSE-CONTENT）。
所引 WALS 数据同为 CC BY 4.0；CEFR 描述符版权归欧洲委员会（Council of Europe），
此处仅以引注方式指向，不复制其描述符文本。
