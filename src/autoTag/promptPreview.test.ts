import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 预览:设置页那个按钮背后的全部逻辑。
 * 它必须在**没有聊天**时明确报错而不是渲染半成品,并且真的走一遍与发送一致的装配。
 */
const mocks = vi.hoisted(() => ({
  context: null as Record<string, any> | null,
}));

// 只换掉 getContext:prompt.ts 还要用同一个模块的 isAiStoryMessage / isStoryMessage
vi.mock('@/st/context', async importOriginal => {
  const actual = await importOriginal<typeof import('@/st/context')>();
  return { ...actual, getContext: () => mocks.context };
});

function chatContext(): Record<string, any> {
  return {
    chat: [
      { name: 'User', is_user: true, is_system: false, mes: '第一层' },
      { name: 'Char', is_user: false, is_system: false, mes: '目标正文第一行\n\n第三行' },
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

describe('buildPromptPreview', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  });

  it('没有打开聊天时给出提示,不渲染半成品', async () => {
    mocks.context = null;
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const out = await buildPromptPreview();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('请先打开一个聊天');
  });

  it('默认取当前聊天最后一楼,返回逐块明细与最终消息', async () => {
    mocks.context = chatContext();
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const out = await buildPromptPreview();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.floor).toBe(1);
    expect(out.floorCount).toBe(2);
    expect(out.assembly.blocks.length).toBeGreaterThan(0);
    expect(out.assembly.messages.length).toBeGreaterThan(0);
    // 默认预设本身应当没有可抱怨的地方
    expect(out.warnings).toEqual([]);
  });

  it('楼层越界时报错而不是静默取最后一楼', async () => {
    mocks.context = chatContext();
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const out = await buildPromptPreview(9);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('不存在');
  });

  it('正文被清洗空时报错', async () => {
    mocks.context = { ...chatContext(), chat: [{ name: 'Char', is_user: false, is_system: false, mes: '   ' }] };
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const out = await buildPromptPreview();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('正文是空的');
  });

  it('协议块被停用时提醒自动配图会解析失败(非阻断)', async () => {
    mocks.context = chatContext();
    const { settings } = await import('@/state/settings');
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const preset = settings.autoTag.promptConfig!.presets[0];
    for (const block of preset.blocks) if (block.builtin === 'contract') block.enabled = false;
    const out = await buildPromptPreview();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings.join()).toContain('示例 JSON');
  });

  it('预设里出现未识别变量时点名提示', async () => {
    mocks.context = chatContext();
    const { settings } = await import('@/state/settings');
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    settings.autoTag.promptConfig!.presets[0].blocks.push({
      id: 'blk_typo',
      name: '打错字了',
      role: 'user',
      content: '{{char_libary}}',
      enabled: true,
    });
    const out = await buildPromptPreview();
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings.join()).toContain('char_libary');
  });

  /**
   * 预填充联动的核心回归:渠道设置**不再影响任何块**。
   * 用户实测过的 bug 是「渠道关掉发送预填充 → 装配层跳掉标记块、发送层又按'末尾是 assistant'
   * 丢一条 → 把预填充块前面那条 9601 字的破限块整块丢掉」。现在两处联动都已删除:
   * 换渠道、开关预填充都不再改变装配结果,自己的 assistant 块一定在。
   */
  it('渠道不再影响任何块:副 API 与跟随主 API 的装配结果一致,自己的 assistant 块都在', async () => {
    mocks.context = chatContext();
    const { settings, newChannel } = await import('@/state/settings');
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');

    const preset = settings.autoTag.promptConfig!.presets[0];
    const original = [...preset.blocks];
    try {
      // 末尾照用户的真实形态摆:一条自己的 assistant 破限块 + 原预填充块(现为普通块)
      preset.blocks = [
        ...original,
        {
          id: 'blk_regression_jailbreak',
          name: '我的助手块',
          role: 'assistant' as const,
          content: 'JAILBREAK-CONTENT-9601',
          enabled: true,
        },
      ];

      const channel = newChannel();
      channel.name = '测试渠道';
      settings.channels = [channel];
      settings.assignments.tagGen = channel.id;
      const viaChannel = await buildPromptPreview();
      expect(viaChannel.ok).toBe(true);
      if (!viaChannel.ok) return;
      expect(viaChannel.channelName).toBe('测试渠道');

      settings.channels = [];
      settings.assignments.tagGen = '';
      const viaMain = await buildPromptPreview();
      expect(viaMain.ok).toBe(true);
      if (!viaMain.ok) return;
      expect(viaMain.channelName).toBeNull();

      // 换渠道(以及任何"发送预填充"式的渠道开关)都不该改变消息内容
      expect(viaMain.assembly.messages.map(m => `${m.role}:${m.content}`)).toEqual(
        viaChannel.assembly.messages.map(m => `${m.role}:${m.content}`),
      );
      // 自己的块在,而且是最后一条(它就是预设的末尾块)
      const messages = viaChannel.assembly.messages;
      expect(messages[messages.length - 1].content).toContain('JAILBREAK-CONTENT-9601');
      // 原预填充块(普通块,默认开)也照发。它与末尾那条同为 assistant,相邻合并成了一条,
      // 所以按"开头是 <thinking>"断言,而不是找一条正好等于 <thinking> 的消息。
      expect(messages[messages.length - 1].content.startsWith('<thinking>')).toBe(true);
    } finally {
      preset.blocks = original;
    }
  });

  it('原预填充块(现为普通块)跟随自己的开关', async () => {
    mocks.context = chatContext();
    const { settings } = await import('@/state/settings');
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    settings.channels = [];
    settings.assignments.tagGen = '';
    const preset = settings.autoTag.promptConfig!.presets[0];
    const prefill = preset.blocks.find(b => b.name === '预填充');
    expect(prefill).toBeTruthy();
    const was = prefill!.enabled;
    try {
      prefill!.enabled = false;
      const out = await buildPromptPreview();
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const block = out.assembly.blocks.find(b => b.name === '预填充');
      // 普通块的停用理由就是 disabled,不再有 api-off 那一档
      expect(block?.skipped).toBe(true);
      expect(block?.skipReason).toBe('disabled');
      expect(out.assembly.messages.some(m => m.content.trim() === '<thinking>')).toBe(false);
    } finally {
      prefill!.enabled = was;
    }
  });

  /**
   * 酒馆宏的展宏与"没展开会怎样"。
   * 用户实测的入口是预设里写了 `{{roll 1999999}}`(空格写法,酒馆的 roll 正则认它),
   * 但副 API 渠道以前完全不经过酒馆,于是这串东西被原样发给了模型 —— 而且预览一声不吭。
   */
  const withMacroBlock = async (content: string) => {
    const { settings } = await import('@/state/settings');
    settings.channels = [];
    settings.assignments.tagGen = '';
    const preset = settings.autoTag.promptConfig!.presets[0];
    const original = [...preset.blocks];
    preset.blocks = [
      ...original,
      { id: 'blk_macro_probe', name: '宏探针', role: 'user' as const, content, enabled: true },
    ];
    return () => {
      preset.blocks = original;
    };
  };

  it('上下文提供 substituteParams 时酒馆宏会被展开(roll → 具体数字),并提示"每次重新取值"', async () => {
    mocks.context = {
      ...chatContext(),
      // 替代真实酒馆宏引擎:把 {{roll N}} 换成一个固定数字,{{persona}} 也照展
      // (插件自己也用 {{persona}} 取玩家设定,不展它就会在"未展开"名单里出现,干扰断言)
      substituteParams: (text: string) =>
        text.replace(/\{\{\s*roll\s+\d+\}\}/gi, '424242').replace(/\{\{\s*persona\}\}/gi, 'PERSONA'),
    };
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const restore = await withMacroBlock('随机种子 {{roll 1999999}} 结束');
    try {
      const out = await buildPromptPreview();
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const probe = out.assembly.blocks.find(b => b.id === 'blk_macro_probe');
      expect(probe?.text).toContain('424242');
      expect(probe?.text).not.toContain('{{roll');
      // 预览里显示的是一个示例值,必须说明实际发送时会重新取值
      expect(out.warnings.some(w => w.includes('每次生成都会重新取值'))).toBe(true);
      // 已经展宏成功,就不该再被列进"会原样发送"的名单
      const leftoverWarn = out.warnings.find(w => w.includes('原样'));
      if (leftoverWarn) expect(leftoverWarn).not.toContain('{{roll 1999999}}');
    } finally {
      restore();
    }
  });

  it('没有展宏能力时(或宏拼错),残留的花括号会被点名警告而不是静默发送', async () => {
    mocks.context = chatContext(); // 故意不给 substituteParams
    const { buildPromptPreview } = await import('@/autoTag/promptPreview');
    const restore = await withMacroBlock('随机种子 {{roll 1999999}} 与 {{rol 5}} 结束');
    try {
      const out = await buildPromptPreview();
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const probe = out.assembly.blocks.find(b => b.id === 'blk_macro_probe');
      expect(probe?.text).toContain('{{roll 1999999}}');
      const joined = out.warnings.join('\n');
      expect(joined).toContain('原样');
      expect(joined).toContain('{{roll 1999999}}');
      expect(joined).toContain('{{rol 5}}');
    } finally {
      restore();
    }
  });
});
