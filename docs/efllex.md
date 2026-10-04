# EFLLex 词表使用与许可

## 来源

Lingua 的英语难度管道 L1（CEFR 分级词表累计覆盖率）使用 **EFLLex**（Dürlich & François 2018）：

- 论文：*EFLLex: A graded lexical resource for learners of English as a foreign language* (LREC 2018)
- 作者：Luise Dürlich, Thomas François
- 机构：Uppsala University；CENTAL, UCLouvain
- 官网/下载：<https://cental.uclouvain.be/cefrlex/efllex/>

## 许可

EFLLex 以 **CC BY-NC-SA 4.0** 发布：

- 可自由下载用于**非商业**研究与教学；
- 必须署名；
- 衍生分发需采用相同许可；
- **商业化使用前需向 CENTAL 核实或替换词表**（如改用 CEFR-J + Octanove + 自建标注，或申请 EVP 授权）。

本仓库（Lingua）代码采用 MIT，内容采用 CC BY 4.0；**EFLLex 词表数据不随仓库分发**。

## 下载与转换

运行仓库根目录脚本：

```bash
node scripts/download-efllex.mjs --data-dir ./data
```

脚本会：

1. 从 CENTAL 下载 `EFLLex_with_NLP4J.tsv`（约 7 MB）。
2. 校验 SHA-256（如官方更新会提示核对）。
3. 解析为 `Record<lemma, Cefr>`，输出 `./data/efllex.json`。

`apps/shell/src/wordlist-loader.ts` 启动时会优先读取 `<dataDir>/efllex.json`；若不存在则回退到极小内置假词表并输出警告。

## 词表口径

- 公开 release 覆盖 CEFR A1–C1，**无 C2 档**；难度管道把 off-list 词计入最难档 C2。
- 每个 lemma 取「首个非零频率的最低 CEFR 级别」。
- 词形还原复用判分管道 `lemmatizer.ts`（票 02），见 `packages/lingua-core/src/difficulty.ts`。

## 替代方案

若 CC BY-NC-SA 的 NC 条款与后续用途冲突，可替换为：

- CEFR-J Wordlist（<http://www.cefr-j.org/download.html>）
- Octanove Vocabulary Profile C1/C2（<https://github.com/openlanguageprofiles/olp-en-cefrj>）
- 自建标注语料

只需让 `wordlist.lookup(lemma)` 返回 `Cefr | null` 即可接入难度管道。

## 引用

在学术或公开说明中请引用：

> Dürlich, L. and François, T. (2018). EFLLex: A graded lexical resource for learners of English as a foreign language. *Proceedings of LREC 2018*.
