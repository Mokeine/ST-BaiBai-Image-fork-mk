import { describe, expect, it } from 'vitest';

import { parseImagePlan, parseOutfits } from '@/autoTag/protocol';
import { buildAutoTagAssembly } from '@/autoTag/prompt';
import {
  DEFAULT_CONTRACT_TEMPLATE,
  defaultPromptPreset,
  type AutoTagPromptConfig,
  type AutoTagPromptPreset,
  type AutoTagSettings,
} from '@/state/settings';
import type { STContext } from '@/st/context';

/**
 * 服装库第二步:AI 自动建档。
 *
 * 三块拼起来才成立,所以放一个文件里一起钉:
 * 1. 协议解析(parseOutfits)——宽容,但"缺省"与"空串"必须区分开;
 * 2. 条件形状/规则——预设引用 {{outfit_library}} 才下发 outfits,否则一句"别输出";
 * 3. 落库语义(applyOutfitReports 在 state/outfitTags.test.ts)。
 */

const segments = [
  { id: 'P1', sourceLine: 0, text: '第一段' },
  { id: 'P2', sourceLine: 2, text: '第二段' },
];

function planWith(outfits: unknown) {
  return parseImagePlan(
    JSON.stringify({
      images: [{ position: 'P1', tag: 'a girl' }],
      changes: [],
      outfits,
    }),
    segments,
    0,
    3,
  );
}

describe('parseOutfits', () => {
  it('读得出名字/外观/状态', () => {
    const plan = planWith([
      { name: '永夜星河晚礼服', tag: 'navy evening dress', state: '湿润' },
      { name: '暗夜流光蕾丝长手套', tag: 'black elbow gloves' },
    ]);
    expect(plan.outfits).toEqual([
      { name: '永夜星河晚礼服', tag: 'navy evening dress', state: '湿润' },
      { name: '暗夜流光蕾丝长手套', tag: 'black elbow gloves' },
    ]);
  });

  it('缺省与空串语义相反:缺省=不改动,空串=清空', () => {
    const [onlyTag, onlyState, clearState] = planWith([
      { name: 'A', tag: 'x' },
      { name: 'B', state: '破损' },
      { name: 'C', state: '' },
    ]).outfits;
    expect('state' in onlyTag).toBe(false);
    expect('tag' in onlyState).toBe(false);
    expect(clearState).toEqual({ name: 'C', state: '' });
  });

  it('坏条目丢弃,绝不连累 images', () => {
    const plan = planWith([
      null,
      'junk',
      { tag: 'no name' },
      { name: '   ', tag: 'x' },
      { name: 'D', tag: 42 },
      { name: 7, tag: 'x' },
      { name: 'E' },
      [],
    ]);
    expect(plan.outfits).toEqual([]);
    expect(plan.images).toHaveLength(1);
  });

  it('重名去重(名字即主键,重复报告只取第一条)', () => {
    const plan = planWith([
      { name: 'A', tag: 'first' },
      { name: 'A', tag: 'second' },
    ]);
    expect(plan.outfits).toEqual([{ name: 'A', tag: 'first' }]);
  });

  it('混进子标签字面量的那项当没给(会污染后续注入文本)', () => {
    const plan = planWith([
      { name: 'A', tag: 'x<bbi_image>y' },
      { name: 'B', tag: '<nl>bad</nl>' },
      { name: 'C', tag: 'ok' },
    ]);
    expect(plan.outfits).toEqual([{ name: 'C', tag: 'ok' }]);
  });

  it('没有 outfits 键 / 不是数组 → 空数组,不影响既有解析', () => {
    expect(parseOutfits(undefined)).toEqual([]);
    expect(parseOutfits({ name: 'A' })).toEqual([]);
    expect(parseImagePlan(JSON.stringify({ images: [{ position: 'P2', tag: 't' }] }), segments, 0, 3).outfits).toEqual(
      [],
    );
  });
});

/* ── 装配侧:形状与规则的条件展开 ───────────────────────────── */

function options(preset: AutoTagPromptPreset): AutoTagSettings {
  const config: AutoTagPromptConfig = {
    presets: [preset],
    activePresetId: preset.id,
    mergeAdjacent: true,
    mergeSystemUser: false,
    showMoveButtons: false,
    schema: 1,
  };
  return {
    enabled: true,
    contextMessages: 2,
    minImages: 0,
    maxImages: 2,
    retryCount: 1,
    autoGenerate: true,
    promptConfig: config,
  } as AutoTagSettings;
}

function presetWith(extraBlocks: { name: string; content: string }[]): AutoTagPromptPreset {
  return {
    id: 'p1',
    name: 'p',
    blocks: [
      { id: 'b1', name: '固定输出协议', role: 'system', content: DEFAULT_CONTRACT_TEMPLATE, enabled: true },
      ...extraBlocks.map((b, i) => ({
        id: `x${i}`,
        name: b.name,
        role: 'user' as const,
        content: b.content,
        enabled: true,
      })),
    ],
  };
}

function context(): STContext {
  return {
    chat: [
      { name: 'User', is_user: true, is_system: false, mes: '上一层' },
      { name: 'Char', is_user: false, is_system: false, mes: '目标第一行\n\n目标第三行' },
    ],
    chatMetadata: {},
    name1: 'User',
    name2: 'Char',
    getCurrentChatId: () => 'chat-a',
    getRequestHeaders: () => ({}),
    saveMetadataDebounced: () => undefined,
    saveChat: async () => undefined,
    eventSource: { on: () => undefined },
  } as unknown as STContext;
}

describe('装备库开关由预设决定', () => {
  it('预设引用了 {{outfit_library}} → 形状里带 outfits', async () => {
    const assembly = await buildAutoTagAssembly(
      context(),
      1,
      options(presetWith([{ name: '服装库', content: '{{outfit_library}}' }])),
      null,
    );
    const text = assembly.messages.map(m => m.content).join('\n');
    expect(text).toContain('"outfits"');
    // 规则本身已搬进块(见默认预设),这里只钉"形状随开关变化"这一件事
    expect(text).toContain('【服装库】');
  });

  it('预设没引用 → 形状不含 outfits(契约声明形状固定,不会自成多一个键)', async () => {
    const assembly = await buildAutoTagAssembly(
      context(),
      1,
      options(presetWith([{ name: '别的块', content: '普通文本' }])),
      null,
    );
    const text = assembly.messages.map(m => m.content).join('\n');
    expect(text).not.toContain('"outfits"');
  });

  it('块被停用等同于没引用(不用这个功能的人不会被动多付 token)', async () => {
    const preset = presetWith([{ name: '服装库', content: '{{outfit_library}}' }]);
    preset.blocks[1].enabled = false;
    const assembly = await buildAutoTagAssembly(context(), 1, options(preset), null);
    expect(assembly.messages.map(m => m.content).join('\n')).not.toContain('"outfits"');
  });

  it('默认预设的「服装库」块自带规则与变量(改规则 = 改块文本,不必再动契约)', () => {
    const preset = defaultPromptPreset('nai', 'nai-diffusion-5-full');
    const block = preset.blocks.find(b => b.name === '服装库');
    expect(block?.content).toContain('{{outfit_library}}');
    expect(block?.content).toContain('不是「未装备」');
    expect(block?.content).toContain('武器与服装一视同仁');
    expect(block?.content).toContain('outfits');
    // 契约里不再有服装规则变量(规则只此一处,避免两处各改一半)
    expect(DEFAULT_CONTRACT_TEMPLATE).not.toContain('outfit_rule');
  });
});
