import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 服装库(state/outfitTags.ts)测试。
 *
 * 覆盖这个功能真正的风险面:
 * - **名字即主键**(逐字相等才对得上档):重复/空白名字必须被清洗,任何一层都不能出现同名两条;
 * - **两层合并**:同名时本聊天覆盖全局,且全局那条不再单独出现;
 * - **状态只属于本聊天**:全局库不存状态(破损/湿润是剧情状态,跨故事没有意义);
 * - 库是字典、装备段是当前状态:穿脱只改变量,库不因为"换下来"而变化;
 * - 空库注入的是说明而不是空串(块照常发送,AI 才知道机制存在)。
 */

interface FakeCtx {
  extensionSettings: Record<string, unknown>;
  chatMetadata: Record<string, unknown>;
  saveMetadataDebounced: ReturnType<typeof vi.fn>;
  saveSettingsDebounced: ReturnType<typeof vi.fn>;
}

let ctx: FakeCtx;
let outfits: typeof import('@/state/outfitTags');

function useCtx(next: FakeCtx): void {
  (globalThis as Record<string, unknown>).window = {
    SillyTavern: { getContext: () => next },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

beforeEach(async () => {
  vi.resetModules();
  ctx = {
    extensionSettings: {},
    chatMetadata: {},
    saveMetadataDebounced: vi.fn(),
    saveSettingsDebounced: vi.fn(),
  };
  useCtx(ctx);
  outfits = await import('@/state/outfitTags');
});

describe('服装库 CRUD', () => {
  it('新增即落盘,名字与内容都 trim', () => {
    outfits.setOutfit('  星穹律动  ', { tag: '  white silk gown  ', state: '  湿润  ' });
    expect(outfits.chatOutfitLib.entries).toEqual([
      { name: '星穹律动', tag: 'white silk gown', state: '湿润' },
    ]);
    expect(ctx.saveMetadataDebounced).toHaveBeenCalledTimes(1);
    const stored = ctx.chatMetadata[outfits.OUTFIT_CHAT_META_KEY] as { entries: unknown[] };
    expect(stored.entries).toEqual([{ name: '星穹律动', tag: 'white silk gown', state: '湿润' }]);
  });

  it('同名即更新,不会长出第二条', () => {
    outfits.setOutfit('星穹律动', { tag: 'v1' });
    outfits.setOutfit('星穹律动', { tag: 'v2', state: '破损' });
    expect(outfits.chatOutfitLib.entries).toEqual([{ name: '星穹律动', tag: 'v2', state: '破损' }]);
  });

  it('只改状态时不会把外观清空(反向也一样)', () => {
    outfits.setOutfit('星穹律动', { tag: 'gown' });
    outfits.setOutfit('星穹律动', { state: '湿润' });
    expect(outfits.chatOutfitLib.entries[0]).toEqual({ name: '星穹律动', tag: 'gown', state: '湿润' });
  });

  it('空名字被忽略(否则会出现永远对不上档的条目)', () => {
    outfits.setOutfit('   ', { tag: 'x' });
    expect(outfits.chatOutfitLib.entries).toEqual([]);
    expect(ctx.saveMetadataDebounced).not.toHaveBeenCalled();
  });

  it('删除只删指定层里指定的一条', () => {
    outfits.setOutfit('A', { tag: 'a' });
    outfits.setOutfit('B', { tag: 'b' });
    outfits.removeOutfit('A', 'chat');
    expect(outfits.chatOutfitLib.entries.map(e => e.name)).toEqual(['B']);
  });

  it('改名保留内容', () => {
    outfits.setOutfit('星穹律动', { tag: 'gown', state: '湿' });
    outfits.renameOutfit('星穹律动', '星穹律动·改', 'chat');
    expect(outfits.chatOutfitLib.entries).toEqual([{ name: '星穹律动·改', tag: 'gown', state: '湿' }]);
  });

  it('改成已存在的名字则合并,不产生同名两条', () => {
    outfits.setOutfit('甲', { tag: 'jia' });
    outfits.setOutfit('乙', { tag: 'yi' });
    outfits.renameOutfit('甲', '乙', 'chat');
    expect(outfits.chatOutfitLib.entries.map(e => e.name)).toEqual(['乙']);
    expect(outfits.chatOutfitLib.entries[0].tag).toBe('yi');
  });
});

describe('全局层与本聊天层', () => {
  it('同名时本聊天覆盖全局,且全局那条不再单独出现', () => {
    outfits.setOutfit('礼服', { tag: 'global-v' }, 'global');
    outfits.setOutfit('礼服', { tag: 'chat-v', state: '破损' }, 'chat');
    const view = outfits.outfitView();
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ name: '礼服', tag: 'chat-v', state: '破损', layer: 'chat', overridesGlobal: true });
    // 没有同名时,全局条目照常露出
    outfits.removeOutfit('礼服', 'chat');
    const onlyGlobal = outfits.outfitView();
    expect(onlyGlobal).toHaveLength(1);
    expect(onlyGlobal[0]).toMatchObject({ layer: 'global', tag: 'global-v', overridesGlobal: false });
  });

  it('全局库不存状态:写进去也不留(状态是剧情状态,跨故事没有意义)', () => {
    outfits.setOutfit('礼服', { tag: 'v', state: '湿润' }, 'global');
    expect(outfits.globalOutfitLib.entries[0]).toEqual({ name: '礼服', tag: 'v', state: '' });
    const stored = ctx.extensionSettings[outfits.OUTFIT_GLOBAL_SETTINGS_KEY] as { entries: unknown[] };
    expect(stored.entries).toEqual([{ name: '礼服', tag: 'v' }]);
    expect(ctx.saveSettingsDebounced).toHaveBeenCalled();
  });

  it('复制到本聊天:外观带走,状态从空开始', () => {
    outfits.setOutfit('礼服', { tag: 'v' }, 'global');
    outfits.copyOutfitToChat('礼服');
    expect(outfits.chatOutfitLib.entries[0]).toEqual({ name: '礼服', tag: 'v', state: '' });
  });

  it('提升为全局:外观进全局,本聊天那条删掉(状态不带走)', () => {
    outfits.setOutfit('礼服', { tag: 'v', state: '破损' }, 'chat');
    outfits.promoteOutfitToGlobal('礼服');
    expect(outfits.globalOutfitLib.entries[0]).toEqual({ name: '礼服', tag: 'v', state: '' });
    expect(outfits.chatOutfitLib.entries).toEqual([]);
  });

  it('两层分开落盘:本聊天进 chatMetadata,全局进 extensionSettings', () => {
    outfits.setOutfit('A', { tag: 'a' }, 'chat');
    outfits.setOutfit('B', { tag: 'b' }, 'global');
    expect(ctx.chatMetadata[outfits.OUTFIT_CHAT_META_KEY]).toBeTruthy();
    expect(ctx.extensionSettings[outfits.OUTFIT_GLOBAL_SETTINGS_KEY]).toBeTruthy();
    expect((ctx.chatMetadata[outfits.OUTFIT_CHAT_META_KEY] as { entries: unknown[] }).entries).toHaveLength(1);
    expect((ctx.extensionSettings[outfits.OUTFIT_GLOBAL_SETTINGS_KEY] as { entries: unknown[] }).entries).toHaveLength(1);
  });
});

describe('服装库文本注入', () => {
  it('空库给出说明而不是空串(块要照常发送,AI 才知道机制存在)', () => {
    const text = outfits.outfitLibraryText();
    expect(text).toContain('【服装库】');
    expect(text).toContain('当前为空');
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('外观与状态拼在同一行,全局条目带 [global] 前缀', () => {
    outfits.setOutfit('礼服', { tag: 'navy evening dress', state: '湿润' }, 'chat');
    outfits.setOutfit('手套', { tag: 'black elbow gloves' }, 'global');
    const lines = outfits.outfitLibraryText().split('\n');
    expect(lines).toContain('礼服: navy evening dress ｜ 状态: 湿润');
    expect(lines).toContain('[global] 手套: black elbow gloves');
    // 库非空时的抬头:衣物与武器一视同仁 + 库是字典不是出场清单
    expect(outfits.outfitLibraryText()).toContain('衣物与武器一视同仁');
    expect(outfits.outfitLibraryText()).toContain('画面里看不见的装备不要写进 tag');
    // 没状态就不该出现"状态:"字样
    expect(lines.find(l => l.includes('手套'))).not.toContain('状态');
  });

  it('缺外观时明确标出,不静默发一条空行', () => {
    outfits.setOutfit('礼服', {});
    expect(outfits.outfitLibraryText()).toContain('礼服: (尚无外观 tag)');
  });
});

describe('AI 报告落库(applyOutfitReports)', () => {
  it('新条目:建到本聊天层', () => {
    const applied = outfits.applyOutfitReports([
      { name: '永夜星河晚礼服', tag: 'navy evening dress', state: '' },
    ]);
    expect(applied).toBe(1);
    expect(outfits.chatOutfitLib.entries).toEqual([
      { name: '永夜星河晚礼服', tag: 'navy evening dress', state: '' },
    ]);
    expect(ctx.saveMetadataDebounced).toHaveBeenCalled();
  });

  it('缺省的键不动:只报状态时外观保持原样', () => {
    outfits.setOutfit('礼服', { tag: 'navy dress', state: '干燥' });
    const applied = outfits.applyOutfitReports([{ name: '礼服', state: '湿润' }]);
    expect(applied).toBe(1);
    expect(outfits.chatOutfitLib.entries[0]).toEqual({ name: '礼服', tag: 'navy dress', state: '湿润' });
  });

  it('空串清空状态(恢复正常时正是这么报的)', () => {
    outfits.setOutfit('礼服', { tag: 'navy dress', state: '湿润' });
    outfits.applyOutfitReports([{ name: '礼服', state: '' }]);
    expect(outfits.chatOutfitLib.entries[0].state).toBe('');
  });

  it('与现状完全相同的报告跳过,不写盘(否则每次生成都把元数据改脏)', () => {
    outfits.setOutfit('礼服', { tag: 'navy dress', state: '湿润' });
    ctx.saveMetadataDebounced.mockClear();
    const applied = outfits.applyOutfitReports([{ name: '礼服', tag: 'navy dress', state: '湿润' }]);
    expect(applied).toBe(0);
    expect(ctx.saveMetadataDebounced).not.toHaveBeenCalled();
  });

  it('全局条目被 AI 更新时,在本聊天生成覆盖条目(不污染别的故事)', () => {
    outfits.setOutfit('校服', { tag: 'navy school uniform' }, 'global');
    outfits.applyOutfitReports([{ name: '校服', state: '破损' }]);
    expect(outfits.globalOutfitLib.entries[0]).toEqual({ name: '校服', tag: 'navy school uniform', state: '' });
    expect(outfits.chatOutfitLib.entries[0]).toEqual({ name: '校服', tag: '', state: '破损' });
    expect(outfits.outfitView()[0]).toMatchObject({ layer: 'chat', tag: '', state: '破损', overridesGlobal: true });
  });
});

describe('卡片 chips(outfitChips)', () => {
  it('按逗号切、最多 4 段、未显示的用 hidden 计数', () => {
    const out = outfits.outfitChips('a, b, c, d, e, f');
    expect(out.chips).toEqual(['a', 'b', 'c', 'd']);
    expect(out.hidden).toBe(2);
  });

  it('累计字符超上限就少显示(长 tag 自然只出 2~3 段)', () => {
    const out = outfits.outfitChips('1111111111111111111111, 2222222222222222222222, 3333333333333333333333');
    // 22+22=44 ≤60,再加第三个 22 会超 → 只显示 2 段
    expect(out.chips).toHaveLength(2);
    expect(out.hidden).toBe(1);
  });

  it('单段过长截断加省略号;单段 tag 也不会被字符上限吞掉', () => {
    const long = 'x'.repeat(40);
    expect(outfits.outfitChips(long).chips[0]).toBe(`${'x'.repeat(23)}…`);
    expect(outfits.outfitChips(long).chips).toHaveLength(1);
  });

  it('空串与多余逗号不产生空 chip', () => {
    expect(outfits.outfitChips('  , , a ,, b , ')).toEqual({ chips: ['a', 'b'], hidden: 0 });
    expect(outfits.outfitChips('')).toEqual({ chips: [], hidden: 0 });
  });
});

describe('水合与容错', () => {
  it('从聊天元数据读回;无效项与重名被清洗;元数据缺失 = 空库', () => {
    ctx.chatMetadata[outfits.OUTFIT_CHAT_META_KEY] = {
      version: 1,
      entries: [
        { name: 'A', tag: 'a', state: 's' },
        { name: '  ', tag: 'x' },
        { name: 'A', tag: 'dup' },
        'junk',
      ],
    };
    outfits.hydrateOutfitLibrary();
    expect(outfits.chatOutfitLib.entries).toEqual([{ name: 'A', tag: 'a', state: 's' }]);
    ctx.chatMetadata = {};
    outfits.hydrateOutfitLibrary();
    expect(outfits.chatOutfitLib.entries).toEqual([]);
  });

  it('也认手写的纯字典形态 { 服装名: tag }', () => {
    ctx.chatMetadata[outfits.OUTFIT_CHAT_META_KEY] = { 星穹律动: 'gown', 永夜星河晚礼服: 'dress' };
    outfits.hydrateOutfitLibrary();
    expect(outfits.chatOutfitLib.entries.map(e => `${e.name}=${e.tag}`)).toEqual([
      '星穹律动=gown',
      '永夜星河晚礼服=dress',
    ]);
  });

  it('全局层从 extensionSettings 读回,且不携带状态', () => {
    ctx.extensionSettings[outfits.OUTFIT_GLOBAL_SETTINGS_KEY] = {
      version: 1,
      entries: [{ name: '校服', tag: 'school uniform', state: '不该有状态' }],
    };
    outfits.initGlobalOutfitLibrary();
    expect(outfits.globalOutfitLib.entries).toEqual([{ name: '校服', tag: 'school uniform', state: '' }]);
  });

  it('切聊天:换一份元数据就换一套本聊天库,全局层不受影响', () => {
    outfits.setOutfit('本故事的衣服', { tag: 'x' }, 'chat');
    outfits.setOutfit('全局的衣服', { tag: 'y' }, 'global');
    const other: FakeCtx = {
      extensionSettings: ctx.extensionSettings,
      chatMetadata: {},
      saveMetadataDebounced: vi.fn(),
      saveSettingsDebounced: vi.fn(),
    };
    useCtx(other);
    outfits.hydrateOutfitLibrary();
    expect(outfits.chatOutfitLib.entries).toEqual([]);
    expect(outfits.globalOutfitLib.entries).toHaveLength(1);
    // 旧聊天的库没被这次切换破坏
    expect((ctx.chatMetadata[outfits.OUTFIT_CHAT_META_KEY] as { entries: unknown[] }).entries).toHaveLength(1);
  });
});
