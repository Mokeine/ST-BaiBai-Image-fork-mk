import { describe, expect, it } from 'vitest';

import { ROUGH_TOKEN_HINT, roughTokenLabel, roughTokens } from '@/tokens';

/**
 * token 粗估。它唯一的用途是**段与段之间比大小**(「哪段把提示词撑爆了」),
 * 所以这里钉的是口径与稳定性,不是精度。
 */
describe('roughTokens 粗估', () => {
  it('空串为 0', () => {
    expect(roughTokens('')).toBe(0);
  });

  it('中日韩按 1 字 1 token', () => {
    expect(roughTokens('你好世界')).toBe(4);
    expect(roughTokens('こんにちは')).toBe(5);
  });

  it('拉丁文按 4 字符 1 token', () => {
    expect(roughTokens('a'.repeat(40))).toBe(10);
  });

  it('中英混排两段分别计入', () => {
    // 4 个汉字 + 8 个 ASCII → 4 + 2
    expect(roughTokens('你好世界abcdefgh')).toBe(6);
  });

  it('代理对(emoji)按一个字符算,不重复计数', () => {
    // '🎨' 的 length 是 2,但按码点只应算 1 个字符 → 1/4 → 四舍五入 0
    expect(roughTokens('🎨')).toBe(0);
    expect(roughTokens('🎨'.repeat(4))).toBe(1);
  });

  it('结果随文本变长而单调不减(段间比大小是它唯一的用途)', () => {
    const short = roughTokens('短文本');
    const long = roughTokens('短文本'.repeat(50));
    expect(long).toBeGreaterThan(short);
  });

  it('全角标点也算 1 token(否则中文标点密的长块会被低估)', () => {
    expect(roughTokens('，。！？')).toBe(4);
  });
});

describe('roughTokenLabel(UI 上唯一该用的写法)', () => {
  it('带 ≈ 前缀、不带"字"、带千分位', () => {
    expect(roughTokenLabel('')).toBe('≈0');
    expect(roughTokenLabel('你好')).toBe('≈2');
    // 4000 个 ASCII → 1000 token → 千分位
    expect(roughTokenLabel('a'.repeat(4000))).toBe('≈1,000');
  });

  it('口径说明不出现"字"以外的歧义,并说明是粗估', () => {
    expect(ROUGH_TOKEN_HINT).toContain('粗估');
    expect(ROUGH_TOKEN_HINT).toContain('1 token');
  });
});
