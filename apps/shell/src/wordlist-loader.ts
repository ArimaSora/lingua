import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Cefr, Wordlist } from "@lingua/core";

// 词表加载（issue #10）：优先使用数据目录中的 efllex.json（由 scripts/download-efllex.mjs 下载），
// 不存在则回退到极小内置假词表，保证无词表时也能启动并跑通测试。
// EFLLex 是 CC BY-NC-SA 4.0，词表数据绝不随仓库分发。

const FALLBACK: Record<string, Cefr> = {
  the: "A1", a: "A1", an: "A1", and: "A1", or: "A1", but: "A1",
  be: "A1", have: "A1", do: "A1", say: "A1", get: "A1", make: "A1",
  go: "A1", know: "A1", take: "A1", see: "A1", come: "A1", think: "A1",
  look: "A1", want: "A1", give: "A1", use: "A1", find: "A1", tell: "A1",
  ask: "A1", work: "A1", seem: "A1", feel: "A1", try: "A1", leave: "A1",
  call: "A1", good: "A1", new: "A1", first: "A1", last: "A1", long: "A1",
  great: "A1", little: "A1", own: "A1", other: "A1", old: "A1", right: "A1",
  big: "A1", high: "A1", different: "A1", small: "A1", large: "A1", next: "A1",
  early: "A1", young: "A1", important: "A1", few: "A1", public: "A1", bad: "A1",
  same: "A1", able: "A1", i: "A1", you: "A1", he: "A1", she: "A1", it: "A1",
  we: "A1", they: "A1", my: "A1", your: "A1", his: "A1", her: "A1", its: "A1",
  our: "A1", their: "A1", me: "A1", him: "A1", them: "A1", us: "A1",
  what: "A1", which: "A1", who: "A1", when: "A1", where: "A1", why: "A1", how: "A1",
  all: "A1", each: "A1", every: "A1", both: "A1", more: "A1", most: "A1",
  some: "A1", such: "A1", no: "A1", not: "A1", only: "A1",
  so: "A1", than: "A1", too: "A1", very: "A1", just: "A1",
  one: "A1", two: "A1", three: "A1", four: "A1", five: "A1", six: "A1", seven: "A1",
  eight: "A1", nine: "A1", ten: "A1",
};

export function loadEfllexWordlist(dataDir: string): Wordlist {
  const path = join(dataDir, "efllex.json");
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Cefr>;
    return { lookup: (lemma) => raw[lemma] ?? null };
  }
  console.warn(`未找到 EFLLex 词表（${path}），使用内置极小假词表。运行 node scripts/download-efllex.mjs 下载真实词表。`);
  return { lookup: (lemma) => FALLBACK[lemma] ?? null };
}
