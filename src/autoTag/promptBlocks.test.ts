import { describe, expect, it } from 'vitest';

import { buildAutoTagAssembly, buildAutoTagMessages } from '@/autoTag/prompt';
import {
  DEFAULT_PROMPT_PRESET_ID,
  defaultPromptPreset,
  emptyAutoTagPrompts,
  type AutoTagPromptConfig,
  type AutoTagPromptPreset,
  type AutoTagPrompts,
  type AutoTagSettings,
} from '@/state/settings';
import type { STContext } from '@/st/context';

/**
 * 消息块装配的端到端(不碰网络):预设怎么排,最终消息就怎么发。
 * 逐块内容与旧版等价的断言在 prompt.test.ts,这里只钉「块系统本身」的行为。
 */

function prompts(): AutoTagPrompts {
  return {
    jailbreak: '',
    naiSpec: '',
    naiV5Spec: '',
    comfySpec: '',
    comfyThinking: '',
    naiThinking: '',
    naiV5Thinking: '',
    prefill: '',
  };
}

function options(config?: AutoTagPromptConfig): AutoTagSettings {
  return {
    enabled: true,
    contextMessages: 2,
    minImages: 0,
    maxImages: 2,
    retryCount: 1,
    autoGenerate: true,
    prompts: prompts(),
    ...(config ? { promptConfig: config } : {}),
  };
}

function config(preset: AutoTagPromptPreset, overrides: Partial<AutoTagPromptConfig> = {}): AutoTagPromptConfig {
  return {
    presets: [preset],
    activePresetId: preset.id,
    mergeAdjacent: true,
    mergeSystemUser: false,
    showMoveButtons: false,
    schema: 1,
    ...overrides,
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
    eventTypes: {
      USER_MESSAGE_RENDERED: 'user',
      CHARACTER_MESSAGE_RENDERED: 'character',
      MESSAGE_SENT: 'sent',
      GENERATION_STARTED: 'started',
      GENERATION_ENDED: 'ended',
      CHAT_CHANGED: 'changed',
      MESSAGE_EDITED: 'edited',
      MESSAGE_UPDATED: 'updated',
      MESSAGE_SWIPED: 'swiped',
      MESSAGE_DELETED: 'deleted',
    },
  };
}

const block = (
  id: string,
  name: string,
  role: 'system' | 'user' | 'assistant',
  content: string,
  enabled = true,
) => ({ id, name, role, content, enabled });

describe('消息块装配', () => {
  it('默认预设 + 合并开:18 块并成 3 条消息', async () => {
    const assembly = await buildAutoTagAssembly(context(), 1, options(), null);
    expect(assembly.blocks).toHaveLength(18);
    expect(assembly.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant']);
    // 用户侧六块合并成一条,空块(角色卡/人设/世界书/任务备注)不占位
    const user = assembly.messages[1];
    expect(user.content).toContain('【角色固定外貌库】');
    expect(user.content).toContain('【服装库】');
    expect(user.content).toContain('--- 目标正文｜assistant（Char） ---');
    expect(user.content).not.toContain('任务备注');
  });

  it('关掉合并:每个未跳过的块各成一条', async () => {
    const preset = defaultPromptPreset('comfyui', '');
    const assembly = await buildAutoTagAssembly(
      context(),
      1,
      options(config(preset, { mergeAdjacent: false })),
      null,
    );
    const live = assembly.blocks.filter(b => !b.skipped);
    expect(assembly.messages.map(m => m.role)).toEqual(live.map(b => b.role));
    expect(assembly.messages.map(m => m.content)).toEqual(live.map(b => b.text));
    // 本 fixture 没有角色卡/人设/世界书,上下文也只剩目标楼 → 18 块里多条被跳过
    expect(live.length).toBeLessThan(18);
  });

  it('空预设装配出零条消息(是否报错由发送入口决定)', async () => {
    const assembly = await buildAutoTagAssembly(
      context(),
      1,
      options(config({ id: DEFAULT_PROMPT_PRESET_ID, name: 'T', blocks: [] })),
      null,
    );
    expect(assembly.messages).toHaveLength(0);
  });

  it('块的顺序就是消息的顺序', async () => {
    const preset: AutoTagPromptPreset = {
      id: 'p',
      name: '倒过来',
      blocks: [
        block('a', '预填充', 'assistant', '<thinking>'),
        block('b', '破限', 'system', '破限文本'),
      ],
    };
    const assembly = await buildAutoTagAssembly(
      context(),
      1,
      options(config(preset, { mergeAdjacent: false })),
      null,
    );
    expect(assembly.messages).toEqual([
      { role: 'assistant', content: '<thinking>' },
      { role: 'system', content: '破限文本' },
    ]);
  });

  it('块的角色可自由改:把目标正文改成 system 就会并进 system 段', async () => {
    const preset: AutoTagPromptPreset = {
      id: 'p',
      name: 'P',
      blocks: [
        block('a', '破限', 'system', '破限文本'),
        block('b', '目标正文', 'system', '--- 目标正文｜{{target_role}} ---\n{{target_text}}'),
      ],
    };
    const assembly = await buildAutoTagAssembly(context(), 1, options(config(preset)), null);
    expect(assembly.messages).toHaveLength(1);
    expect(assembly.messages[0].role).toBe('system');
    expect(assembly.messages[0].content).toContain('破限文本');
    expect(assembly.messages[0].content).toContain('目标第一行');
  });

  it('停用的块不发送,但预览里仍能看到它的内容与原因', async () => {
    const preset: AutoTagPromptPreset = {
      id: 'p',
      name: 'P',
      blocks: [
        block('a', '破限', 'system', '破限文本'),
        block('b', '我关掉的', 'user', '不该出现', false),
      ],
    };
    const assembly = await buildAutoTagAssembly(context(), 1, options(config(preset)), null);
    expect(assembly.messages.map(m => m.content)).toEqual(['破限文本']);
    const off = assembly.blocks.find(b => b.id === 'b')!;
    expect(off.skipped).toBe(true);
    expect(off.skipReason).toBe('disabled');
    expect(off.text).toBe('不该出现');
  });

  it('合并 System 和 User:全部 system 降级后与 user 合并', async () => {
    const preset: AutoTagPromptPreset = {
      id: 'p',
      name: 'P',
      blocks: [block('a', '破限', 'system', 'S'), block('b', '正文', 'user', 'U')],
    };
    const assembly = await buildAutoTagAssembly(
      context(),
      1,
      options(config(preset, { mergeSystemUser: true })),
      null,
    );
    expect(assembly.messages).toEqual([{ role: 'user', content: 'S\n\nU' }]);
  });

  it('一条都发不出去时,发送入口直接给出可操作的报错', async () => {
    const preset: AutoTagPromptPreset = {
      id: 'p',
      name: 'P',
      blocks: [block('a', '空的', 'system', '', true)],
    };
    await expect(
      buildAutoTagMessages(context(), 1, options(config(preset)), null),
    ).rejects.toThrow(/自定义提示词/);
  });

  it('预览与发送走同一套装配(块明细可用于展示)', async () => {
    const assembly = await buildAutoTagAssembly(context(), 1, options(), null);
    const names = assembly.blocks.map(b => b.name);
    expect(names[0]).toBe('破限词');
    expect(names).toContain('固定输出协议');
    expect(assembly.presetName).toBe('柏宝绘默认');
  });

  it('装配只读,不改动传入的预设对象', async () => {
    const preset = defaultPromptPreset('comfyui', '');
    const before = JSON.stringify(preset);
    await buildAutoTagAssembly(context(), 1, options(config(preset)), null);
    expect(JSON.stringify(preset)).toBe(before);
  });
});
