import { describe, expect, it } from 'vitest';

import {
  assembleMessages,
  mergeAdjacentMessages,
  renderPresetBlocks,
  renderTemplate,
} from '@/autoTag/promptRender';
import type { PromptVariableValues } from '@/autoTag/promptVars';
import type { AutoTagPromptPreset } from '@/state/settings';

function values(overrides: Partial<PromptVariableValues> = {}): PromptVariableValues {
  return {
    char_card: '',
    persona: '',
    world_info: '',
    book_memory: 'MEM',
    char_library: 'LIB',
    outfit_library: 'OUTFITS',
    chat_context: 'CTX',
    target_text: 'TXT',
    target_role: 'assistant（小雪）',
    task_note: '',
    output_shape: '{"images":[]}',
    image_count_rule: '2. 数量',
    content_rule: '4. 内容',
    negative_rule: '',
    character_rule: '7. 建档',
    nl: '',
    ...overrides,
  };
}

function preset(blocks: AutoTagPromptPreset['blocks']): AutoTagPromptPreset {
  return { id: 'p', name: 'T', blocks };
}

describe('renderTemplate', () => {
  it('替换变量,并允许括号内空格', () => {
    const out = renderTemplate('A{{char_library}}B{{ char_library }}C', values());
    expect(out.text).toBe('ALIBBLIBC');
    expect(out.vars).toEqual(['char_library']);
  });

  // 展宏(substituteParams)必须在插件变量之后:顺序反了,酒馆不认识 {{char_card}} 会把它吞掉
  it('expandMacros 在插件变量之后调用,能拿到已替换的文本', () => {
    const seen: string[] = [];
    const out = renderTemplate('{{char_library}}-{{roll 6}}', values(), text => {
      seen.push(text);
      return text.replace('{{roll 6}}', '4');
    });
    expect(seen).toEqual(['LIB-{{roll 6}}']);
    expect(out.text).toBe('LIB-4');
  });

  it('不传 expandMacros 时宏原样留下(纯逻辑单测走的就是这条)', () => {
    const out = renderTemplate('{{roll 1999999}}', values());
    expect(out.text).toBe('{{roll 1999999}}');
    expect(out.volatileMacros).toEqual(['{{roll 1999999}}']);
  });

  it('认出"每次取值可能不同"的宏(roll/random/pick),且只认整块花括号', () => {
    const out = renderTemplate('{{roll 1d6}} {{random:a,b}} {{pick:x,y}} {{char_library}}', values());
    expect(out.volatileMacros).toEqual(['{{roll 1d6}}', '{{random:a,b}}', '{{pick:x,y}}']);
  });

  it('未识别的变量原样保留,并单独记下来', () => {
    const out = renderTemplate('{{nope}} 与 {{char_library}}', values());
    expect(out.text).toBe('{{nope}} 与 LIB');
    expect(out.vars).toEqual(['char_library']);
    expect(out.unknownVars).toEqual(['nope']);
  });

  it('取不到值的变量渲染成空串(不是字面量)', () => {
    expect(renderTemplate('[{{char_card}}]', values()).text).toBe('[]');
  });

  it('{{nl}} 置空后留下的连续空行按旧口径折叠', () => {
    const out = renderTemplate('上\n\n{{nl}}\n\n下', values({ nl: '' }));
    expect(out.text).toBe('上\n\n下');
  });

  it('不引用 {{nl}} 的模板不动原文空行', () => {
    // 正文/世界书里的连续空行属于内容本身,顺手折叠会改掉用户的东西
    const out = renderTemplate('上\n\n\n\n下', values());
    expect(out.text).toBe('上\n\n\n\n下');
  });
});

describe('renderPresetBlocks 跳过判定', () => {
  it('停用块记 disabled,但仍渲染出内容供预览查看', () => {
    const [block] = renderPresetBlocks(
      preset([{ id: 'a', name: '破限', role: 'system', content: '正文', enabled: false }]),
      values(),
    );
    expect(block.skipped).toBe(true);
    expect(block.skipReason).toBe('disabled');
    expect(block.text).toBe('正文');
  });

  it('不含变量、内容非空 → 照常发送', () => {
    const [block] = renderPresetBlocks(
      preset([{ id: 'a', name: '破限', role: 'system', content: '正文', enabled: true }]),
      values(),
    );
    expect(block.skipped).toBe(false);
  });

  it('引用的内容变量全部没值 → 整块跳过(抓不到角色卡就不发那条)', () => {
    const [block] = renderPresetBlocks(
      preset([
        { id: 'a', name: '角色卡', role: 'system', content: '【角色设定】\n\n{{char_card}}', enabled: true },
      ]),
      values({ char_card: '  ' }),
    );
    expect(block.skipped).toBe(true);
    expect(block.skipReason).toBe('no-content');
  });

  it('多个内容变量里只要有一个有值就不跳过', () => {
    const [block] = renderPresetBlocks(
      preset([
        { id: 'a', name: '合并块', role: 'user', content: '{{char_card}}|{{persona}}', enabled: true },
      ]),
      values({ char_card: '', persona: '主角' }),
    );
    expect(block.skipped).toBe(false);
  });

  it('片段宏不计入跳过判定 —— 关掉自然语言不会吞掉整份规范', () => {
    const [block] = renderPresetBlocks(
      preset([{ id: 'a', name: 'ComfyUI 规范', role: 'system', content: '规范\n\n{{nl}}', enabled: true }]),
      values({ nl: '' }),
    );
    expect(block.skipped).toBe(false);
    expect(block.text).toBe('规范');
  });

  // 预填充块降级为普通块后,不再有任何"由 API 决定发不发"的块:
  // 开关、角色、位置全看它自己存的值。这两条把"普通块语义"钉住。
  it('原预填充块(现为普通块)的开关只看自己存的值', () => {
    const on = preset([
      { id: 'a', name: '预填充', role: 'assistant', content: '<thinking>', enabled: true },
    ]);
    const [live] = renderPresetBlocks(on, values());
    expect(live.skipped).toBe(false);
    expect(live.enabled).toBe(true);
    expect(live.text).toBe('<thinking>');

    const off = preset([
      { id: 'a', name: '预填充', role: 'assistant', content: '<thinking>', enabled: false },
    ]);
    const [skipped] = renderPresetBlocks(off, values());
    expect(skipped.skipped).toBe(true);
    expect(skipped.skipReason).toBe('disabled');
    expect(skipped.enabled).toBe(false);
    // 内容照旧渲染出来,预览里还能看到它长什么样
    expect(skipped.text).toBe('<thinking>');
  });

  it('角色可随意改:原预填充块改成 system 也能发', () => {
    const p = preset([{ id: 'a', name: '预填充', role: 'system', content: '<thinking>', enabled: true }]);
    const [block] = renderPresetBlocks(p, values());
    expect(block.role).toBe('system');
    expect(block.skipped).toBe(false);
  });
});

describe('assembleMessages', () => {
  const blocks = () =>
    renderPresetBlocks(
      preset([
        { id: 'a', name: '破限', role: 'system', content: 'S1', enabled: true },
        { id: 'b', name: '规范', role: 'system', content: 'S2', enabled: true },
        { id: 'c', name: '记忆', role: 'user', content: 'U1', enabled: true },
        { id: 'd', name: '目标正文', role: 'user', content: 'U2', enabled: true },
        { id: 'e', name: '预填充', role: 'assistant', content: 'A1', enabled: true },
      ]),
      values(),
    );

  it('相邻同角色合并,分隔符两个换行', () => {
    const messages = assembleMessages(blocks(), { mergeAdjacent: true, mergeSystemUser: false });
    expect(messages).toEqual([
      { role: 'system', content: 'S1\n\nS2' },
      { role: 'user', content: 'U1\n\nU2' },
      { role: 'assistant', content: 'A1' },
    ]);
  });

  it('关掉合并则逐块成条', () => {
    const messages = assembleMessages(blocks(), { mergeAdjacent: false, mergeSystemUser: false });
    expect(messages.map(m => m.role)).toEqual([
      'system',
      'system',
      'user',
      'user',
      'assistant',
    ]);
  });

  it('合并 System 和 User:system 先降级为 user,再与相邻 user 合并', () => {
    const messages = assembleMessages(blocks(), { mergeAdjacent: true, mergeSystemUser: true });
    expect(messages).toEqual([
      { role: 'user', content: 'S1\n\nS2\n\nU1\n\nU2' },
      { role: 'assistant', content: 'A1' },
    ]);
  });

  it('被跳过的块不进入消息', () => {
    const withDisabled = renderPresetBlocks(
      preset([
        { id: 'a', name: '破限', role: 'system', content: 'S1', enabled: true },
        { id: 'b', name: '规范', role: 'system', content: 'S2', enabled: false },
      ]),
      values(),
    );
    expect(assembleMessages(withDisabled, { mergeAdjacent: true, mergeSystemUser: false })).toEqual([
      { role: 'system', content: 'S1' },
    ]);
  });
});

describe('mergeAdjacentMessages', () => {
  it('只合并相邻同角色,中间隔了别的角色就断开', () => {
    const out = mergeAdjacentMessages([
      { role: 'system', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'system', content: 'C' },
      { role: 'system', content: 'D' },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'system', content: 'C\n\nD' },
    ]);
  });

  it('不改动传入的数组(合并写的是副本)', () => {
    const input = [
      { role: 'system' as const, content: 'A' },
      { role: 'system' as const, content: 'B' },
    ];
    mergeAdjacentMessages(input);
    expect(input[0].content).toBe('A');
  });
});
