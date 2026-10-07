import { describe, expect, it } from 'vitest';

import {
  buildExportPayload,
  canDeletePreset,
  findPresetByName,
  newPromptBlock,
  parseBaibaiPresets,
  parseChatu8Presets,
  parsePresetFile,
  presetFileName,
  restoreContractContent,
  uniquePresetName,
} from '@/autoTag/promptPreset';
import { DEFAULT_CONTRACT_TEMPLATE, type AutoTagPromptPreset } from '@/state/settings';

describe('buildExportPayload', () => {
  it('导出柏宝绘自有格式,块不带 id(自包含、可往返)', () => {
    const presets: AutoTagPromptPreset[] = [
      {
        id: 'preset_1',
        name: '我的预设',
        blocks: [{ id: 'blk_1', name: '破限', role: 'system', content: '文本', enabled: false }],
      },
    ];
    const payload = buildExportPayload(presets, { mergeAdjacent: true, mergeSystemUser: false });
    expect(payload.format).toBe('baibai-prompt-presets');
    expect(payload.version).toBe(1);
    expect(payload.mergeAdjacent).toBe(true);
    expect(payload.mergeSystemUser).toBe(false);
    expect(payload.presets).toEqual([
      { name: '我的预设', blocks: [{ name: '破限', role: 'system', content: '文本', enabled: false }] },
    ]);
    // 块 id 是本地运行时标识,不该进文件
    expect(JSON.stringify(payload)).not.toContain('blk_1');
  });

  it('文件名去掉路径非法字符', () => {
    expect(presetFileName('a/b:c*d?e"f<g>h|i')).toBe('baibai-prompt-a_b_c_d_e_f_g_h_i.json');
    expect(presetFileName('   ')).toBe('baibai-prompt-preset.json');
  });
});

/**
 * 导入必须认得**自己导出的**文件 —— 导出提示写着"分享给别人",
 * 但导入以前只认智绘姬格式,自己导出的文件导回来会得到一堆"不是预设对象"的警告、一个都进不来。
 */
describe('parseBaibaiPresets / parsePresetFile(柏宝绘自有格式)', () => {
  const ownFile = (blocks: unknown[]) => ({
    format: 'baibai-prompt-presets',
    version: 1,
    mergeAdjacent: false,
    mergeSystemUser: false,
    presets: [{ name: '我的预设', blocks }],
  });

  it('读回自己导出的文件:name/role/content/enabled 全部还原', () => {
    const plan = parseBaibaiPresets(
      ownFile([
        { name: '破限', role: 'user', content: '文本', enabled: false },
        { name: '规范', role: 'system', content: 'SPEC', enabled: true },
      ]),
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.presets).toHaveLength(1);
    expect(plan.presets[0].name).toBe('我的预设');
    expect(plan.presets[0].blocks.map(b => [b.name, b.role, b.content, b.enabled])).toEqual([
      ['破限', 'user', '文本', false],
      ['规范', 'system', 'SPEC', true],
    ]);
    // 触发词是智绘姬的概念,自有格式里恒为 0
    expect(plan.presets[0].disabledByTrigger).toBe(0);
  });

  it('往返一致:导出 → 导回,块的内容与开关一字不差', () => {
    const presets: AutoTagPromptPreset[] = [
      {
        id: 'preset_1',
        name: '往返',
        blocks: [
          { id: 'blk_1', name: '固定输出协议', role: 'system', content: DEFAULT_CONTRACT_TEMPLATE, enabled: true, builtin: 'contract' },
          { id: 'blk_2', name: '预填充', role: 'assistant', content: '<thinking>', enabled: false },
        ],
      },
    ];
    const exported = JSON.parse(JSON.stringify(buildExportPayload(presets, { mergeAdjacent: true, mergeSystemUser: false })));
    const back = parsePresetFile(exported);
    expect(back.presets[0].blocks.map(b => [b.name, b.role, b.content, b.enabled, b.builtin])).toEqual([
      ['固定输出协议', 'system', DEFAULT_CONTRACT_TEMPLATE, true, 'contract'],
      ['预填充', 'assistant', '<thinking>', false, undefined],
    ]);
  });

  it('保住 builtin:contract —— 否则导入回来的协议块丢掉「恢复内置默认」', () => {
    const plan = parseBaibaiPresets(
      ownFile([{ name: '固定输出协议', role: 'system', content: 'C', enabled: true, builtin: 'contract' }]),
    );
    expect(plan.presets[0].blocks[0].builtin).toBe('contract');
    // 别的字面量一律丢弃(手改文件不该造出幽灵标记)
    const junk = parseBaibaiPresets(
      ownFile([{ name: 'x', role: 'system', content: 'C', enabled: true, builtin: 'prefill' }]),
    );
    expect(junk.presets[0].blocks[0].builtin).toBeUndefined();
  });

  it('空内容/无效块被丢弃并给出警告;整份没块则丢弃该预设', () => {
    const plan = parseBaibaiPresets(
      ownFile([{ name: '空', role: 'system', content: '', enabled: true }, { name: '坏', role: 'system' }, 'junk']),
    );
    expect(plan.presets).toHaveLength(0);
    expect(plan.warnings.join()).toContain('3 条空内容/无效块');
    expect(plan.warnings.join()).toContain('没有可用块');
  });

  it('不是自有格式时明确报错,而不是返回空计划', () => {
    const plan = parseBaibaiPresets({ 智绘姬预设: { entries: [] } });
    expect(plan.presets).toHaveLength(0);
    expect(plan.warnings[0]).toContain('不是柏宝绘的预设导出格式');
  });

  it('parsePresetFile 按 format 分派:两种格式都认', () => {
    // 自有格式
    expect(parsePresetFile(ownFile([{ name: 'A', role: 'system', content: 'x', enabled: true }])).presets[0].name).toBe(
      '我的预设',
    );
    // 智绘姬格式(没有 format 字段)
    const chatu8 = { 示例预设: { entries: [{ name: '示例条目', role: 'user', content: 'x', enabled: true }] } };
    expect(parsePresetFile(chatu8).presets[0].name).toBe('示例预设');
  });
});

describe('parseChatu8Presets(智绘姬上下文预设)', () => {
  const file = {
    我的上下文: {
      entries: [
        {
          id: 'entry_1',
          name: '系统提示',
          role: 'system',
          content: '你是助手',
          enabled: true,
          triggerMode: 'always',
        },
        {
          id: 'entry_2',
          name: '破限',
          role: 'user',
          content: '继续',
          enabled: true,
          triggerMode: 'trigger',
          triggerWords: 'NSFW',
        },
        { id: 'entry_3', name: '助手', role: 'assistant', content: '好的', enabled: false },
      ],
    },
  };

  it('条目按名字/角色/内容/开关转成块', () => {
    const plan = parseChatu8Presets(file);
    expect(plan.presets).toHaveLength(1);
    const [preset] = plan.presets;
    expect(preset.name).toBe('我的上下文');
    expect(preset.blocks.map(b => [b.name, b.role, b.content, b.enabled])).toEqual([
      ['系统提示', 'system', '你是助手', true],
      ['破限', 'user', '继续', false],
      ['助手', 'assistant', '好的', false],
    ]);
  });

  it('触发模式条目导入为停用,并计数提示', () => {
    const plan = parseChatu8Presets(file);
    expect(plan.presets[0].disabledByTrigger).toBe(1);
    // 原本靠触发词才发的内容不会变成常开 —— 静默改变行为比少导入更糟
    expect(plan.presets[0].blocks[1].enabled).toBe(false);
  });

  it('多预设一次全收(导出全部也是同一形状)', () => {
    const plan = parseChatu8Presets({ A: { entries: [{ content: 'a' }] }, B: { entries: [{ content: 'b' }] } });
    expect(plan.presets.map(p => p.name)).toEqual(['A', 'B']);
  });

  it('非法角色回落 system,缺名字给默认名', () => {
    const plan = parseChatu8Presets({ P: { entries: [{ content: 'x', role: 'tool' }] } });
    expect(plan.presets[0].blocks[0].role).toBe('system');
    expect(plan.presets[0].blocks[0].name).toBe('消息块 1');
  });

  it('空内容/非对象条目丢弃并计数', () => {
    const plan = parseChatu8Presets({ P: { entries: [{ content: '' }, 'junk', { content: 'ok' }] } });
    expect(plan.presets[0].blocks).toHaveLength(1);
    expect(plan.warnings.join()).toContain('2 条空内容/无效条目');
  });

  it('世界书等其它形状一律丢弃并给出说明', () => {
    const worldBooks = parseChatu8Presets({ god: { worldBooks: [{ name: 'x' }] } });
    expect(worldBooks.presets).toHaveLength(0);
    expect(worldBooks.warnings.join()).toContain('没有 entries');
  });

  it('文件根本不是对象时给出格式说明', () => {
    const plan = parseChatu8Presets([{ name: 'arr' }]);
    expect(plan.presets).toHaveLength(0);
    expect(plan.warnings[0]).toContain('不是智绘姬的上下文预设格式');
  });

  it('没有可用条目时整份预设丢弃', () => {
    const plan = parseChatu8Presets({ P: { entries: [] } });
    expect(plan.presets).toHaveLength(0);
    expect(plan.warnings.join()).toContain('没有可用条目');
  });
});

describe('预设重名与删除规则', () => {
  const presets: AutoTagPromptPreset[] = [
    { id: 'bbi_default', name: '柏宝绘默认', blocks: [] },
    { id: 'p2', name: '分享预设', blocks: [] },
  ];

  it('同名才需要问是否覆盖', () => {
    expect(findPresetByName(presets, '分享预设')?.id).toBe('p2');
    expect(findPresetByName(presets, '没这个')).toBeUndefined();
  });

  it('不覆盖时自动起不撞的名字', () => {
    expect(uniquePresetName(presets, '新预设')).toBe('新预设');
    expect(uniquePresetName(presets, '分享预设')).toBe('分享预设(导入)');
    expect(uniquePresetName([...presets, { id: 'p3', name: '分享预设(导入)', blocks: [] }], '分享预设')).toBe(
      '分享预设(导入)2',
    );
  });

  it('默认预设不给删', () => {
    expect(canDeletePreset({ id: 'bbi_default' }, 'bbi_default')).toBe(false);
    expect(canDeletePreset({ id: 'p2' }, 'bbi_default')).toBe(true);
  });
});

describe('块与协议块恢复', () => {
  it('新建块默认启用、角色 system', () => {
    const block = newPromptBlock();
    expect(block.enabled).toBe(true);
    expect(block.role).toBe('system');
    expect(block.id).not.toBe(newPromptBlock().id);
  });

  it('恢复内置默认把协议块内容换成当前版本的默认模板', () => {
    const block = { ...newPromptBlock(), content: '我删光了规则' };
    restoreContractContent(block);
    expect(block.content).toBe(DEFAULT_CONTRACT_TEMPLATE);
  });
});
