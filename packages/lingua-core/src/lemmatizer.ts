/// <reference path="./wink-lemmatizer.d.ts" />
import lemmatizer from "wink-lemmatizer";

// 词形还原（v1 仅英语；ADR-0010：语块命中判定 = 词形还原 + 字符串匹配）。
// 同一函数服务于命中判定与难度管道（ADR-0012：L1 复用判分管道），必须确定性。
// wink-lemmatizer 区分词性；无 POS 时按 verb → noun → adjective 固定顺序取首个
// 有变化的还原（动词优先：语块匹配的关键是把时态/人称变化收敛回动词原形）。

export function lemmatizeWord(word: string): string {
  const lower = word.toLowerCase();
  const base = lower.replace(/['’]s$/, "").replace(/['’]$/, "");
  if (base.length === 0) return lower;
  const verb = lemmatizer.verb(base);
  if (verb !== base) return verb;
  const noun = lemmatizer.noun(base);
  if (noun !== base) return noun;
  return lemmatizer.adjective(base);
}

export type Token = {
  index: number;
  raw: string;
  lemma: string;
  start: number;
  end: number;
  // 前一个 token 与本 token 之间有句末标点（. ! ? …）——匹配不得跨越。
  breakBefore: boolean;
};

// 分词：字母/数字为主体，缩写（don't）保持单 token；标点与 emoji 跳过。
// token 区间匹配的区间即此处的 index，start/end 为原文 char 偏移。
const TOKEN_RE = /[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g;
const SENTENCE_BREAK_RE = /[.!?…]/;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const raw = match[0];
    const previous = tokens[tokens.length - 1];
    const gap = previous ? text.slice(previous.end, match.index) : "";
    tokens.push({
      index: tokens.length,
      raw,
      lemma: lemmatizeWord(raw),
      start: match.index,
      end: match.index + raw.length,
      breakBefore: previous !== undefined && SENTENCE_BREAK_RE.test(gap),
    });
  }
  return tokens;
}
