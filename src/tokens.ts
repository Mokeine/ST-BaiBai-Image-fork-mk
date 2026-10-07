/**
 * 文本的 token 粗估(同步、纯本地)。
 *
 * 为什么不用 ST 的 getTokenCountAsync:那是异步 HTTP(打 /api/tokenizers/…),
 * 展开一条 8 段的记录就是 8 个请求;而这里的数字只用于**段与段之间比大小**
 * (「哪段把提示词撑爆了」),不需要精确。
 *
 * 口径:中日韩按 1 字 1 token,其余(拉丁字母/数字/符号)按 4 字符 1 token——
 * BPE 分词器的通用经验值。**必然与真实用量有出入**,故 UI 上一律带 ≈ 显示,
 * 也不要拿各段之和去对上游 usage 那个真值(口径不同)。
 *
 * 住在顶层而不是 state/history 里:请求历史页与提示词消息块列表都要用它,
 * 它跟"历史记录仓库"没有关系,放在那边会让设置页为了一个纯函数去依赖整个 store。
 */

/**
 * 中日韩表意文字/假名/谚文/全角标点:这些大致 1 字 = 1 token。
 *
 * 用**显式码点区间**而不是字面量正则:这些范围里全是生僻字,写进源码后
 * 一旦经过任何一次编码不当的复制粘贴就会静默变样(而它错了只表现为"估得不太准",极难发现)。
 */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3000, 0x303f], // 中文标点
  [0x3040, 0x30ff], // 日文假名
  [0x3400, 0x4dbf], // 汉字扩展 A
  [0x4e00, 0x9fff], // 基本汉字
  [0xac00, 0xd7af], // 谚文音节
  [0xf900, 0xfaff], // 兼容汉字
  [0xff00, 0xffef], // 全角字符
];

function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

export function roughTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let rest = 0;
  // for...of 按码点遍历,代理对(emoji/罕见汉字)算一个字符而非两个
  for (const ch of text) {
    if (isCjk(ch)) cjk++;
    else rest++;
  }
  return Math.round(cjk + rest / 4);
}

/**
 * UI 上的统一写法:`≈1,234`。
 * 加千分位是为了并排比较时数字宽度稳定(与请求历史页同一口径)。
 */
export function roughTokenLabel(text: string): string {
  return `≈${roughTokens(text).toLocaleString()}`;
}

/** 鼠标悬停时的口径说明(与请求历史页同一套措辞)。 */
export const ROUGH_TOKEN_HINT =
  'token 粗估:中日韩 1 字 1 token、其余 4 字符 1 token;仅供段间比较,与上游真实用量口径不同';
