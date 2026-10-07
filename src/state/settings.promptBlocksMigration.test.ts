import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 「6 个固定提示词字段」→「消息块预设」的迁移。
 *
 * 要点:
 * - 老设置(没有 promptConfig 键)由 6 个字段 + 内置默认**物化**出默认预设,
 *   旧字段原值一律保留(退回旧版本仍可用),不搬第二次;
 * - 规范/思维链按**迁移当下的后端与模型**只启用匹配的那一份,等价于旧版「按后端二选一」;
 * - 已经有 promptConfig 的设置绝不被迁移覆盖。
 */
const mocks = vi.hoisted(() => ({
  context: null as Record<string, any> | null,
}));

vi.mock('@/st/context', () => ({
  getContext: () => mocks.context,
}));

async function hydrateWith(raw: Record<string, unknown>) {
  mocks.context = {
    extensionSettings: { baibai_image: raw },
    saveSettingsDebounced: vi.fn(),
  };
  const { hydrateSettings, settings } = await import('@/state/settings');
  await hydrateSettings();
  return settings;
}

function blockNamed(preset: { blocks: Array<{ name: string; content: string; role: string; enabled: boolean }> }, name: string) {
  const found = preset.blocks.find(b => b.name === name);
  if (!found) throw new Error(`没有名为「${name}」的块`);
  return found;
}

describe('消息块预设的设置迁移', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('toastr', { info: vi.fn(), success: vi.fn(), error: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  });

  it('老设置物化出「柏宝绘默认」,块数固定、内容取仓库内置(不读旧字段)', async () => {
    const settings = await hydrateWith({
      autoTag: { prompts: { jailbreak: '我改的破限', comfySpec: '我改的规范' } },
    });
    const config = settings.autoTag.promptConfig!;
    expect(config.presets).toHaveLength(1);
    expect(config.presets[0].id).toBe('bbi_default');
    expect(config.presets[0].name).toBe('柏宝绘默认');
    expect(config.presets[0].blocks).toHaveLength(18);
    // 默认预设 = 随插件发布的内置提示词:「恢复默认」要能给出真正的出厂版本
    const jailbreak = blockNamed(config.presets[0], '破限词').content;
    expect(jailbreak).toContain('sanctuary_override_directive');
    expect(jailbreak).not.toBe('我改的破限');
    expect(blockNamed(config.presets[0], 'ComfyUI 规范').content).not.toContain('我改的规范');
    // 旧字段本身仍是"回退旧版本仍有效"的存档,原样留在设置里
    expect(settings.autoTag.prompts.jailbreak).toBe('我改的破限');
    expect(settings.autoTag.prompts.comfySpec).toBe('我改的规范');
  });

  it('旧字段不再流进默认预设(用户自己的改动只存在于他自己的预设里)', async () => {
    const settings = await hydrateWith({
      autoTag: {
        prompts: { comfyThinking: '我的思维链', naiThinking: '我的 NAI 思维链', prefill: '我改的预填充>' },
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              blocks: [
                { id: 'blk_jailbreak', name: '破限词', role: 'system', content: 'D', enabled: true },
                { id: 'blk_comfy_thinking', name: 'ComfyUI 思维链', role: 'system', content: 'T', enabled: true },
                { id: 'blk_prefill', name: '预填充', role: 'assistant', content: 'P>', enabled: true },
              ],
            },
            {
              id: 'preset_mine',
              name: '我的预设',
              blocks: [
                { id: 'blk_jailbreak', name: '破限词', role: 'system', content: 'MY JAILBREAK', enabled: true },
              ],
            },
          ],
          activePresetId: 'preset_mine',
          schema: 1,
        },
      },
    });
    const config = settings.autoTag.promptConfig!;
    // 默认预设被原样读回(不因旧字段而改写),自己的预设也一字不动
    expect(blockNamed(config.presets[0], '预填充').content).toBe('P>');
    expect(blockNamed(config.presets[0], 'ComfyUI 思维链').content).toBe('T');
    expect(blockNamed(config.presets[1], '破限词').content).toBe('MY JAILBREAK');
    expect(config.activePresetId).toBe('preset_mine');
  });

  it('留空的字段物化出内置默认全文(预设自包含)', async () => {
    const settings = await hydrateWith({ autoTag: {} });
    const content = blockNamed(settings.autoTag.promptConfig!.presets[0], '破限词').content;
    expect(content).toContain('sanctuary_override_directive');
    expect(blockNamed(settings.autoTag.promptConfig!.presets[0], '预填充').content).toBe('<thinking>');
  });

  it('ComfyUI 后端:只启用 ComfyUI 的规范与思维链', async () => {
    const settings = await hydrateWith({ defaultBackend: 'comfyui', autoTag: {} });
    const preset = settings.autoTag.promptConfig!.presets[0];
    expect(blockNamed(preset, 'ComfyUI 规范').enabled).toBe(true);
    expect(blockNamed(preset, 'ComfyUI 思维链').enabled).toBe(true);
    expect(blockNamed(preset, 'NAI 规范').enabled).toBe(false);
    expect(blockNamed(preset, 'NAI 规范(4 系)').enabled).toBe(false);
  });

  it('NAI 后端 + 4.5/V5 模型:启用 V5 那一对', async () => {
    const settings = await hydrateWith({
      defaultBackend: 'nai',
      nai: { model: 'nai-diffusion-5-full' },
      autoTag: {},
    });
    const preset = settings.autoTag.promptConfig!.presets[0];
    expect(blockNamed(preset, 'NAI 规范').enabled).toBe(true);
    expect(blockNamed(preset, 'NAI 思维链').enabled).toBe(true);
    expect(blockNamed(preset, 'NAI 规范(4 系)').enabled).toBe(false);
    expect(blockNamed(preset, 'ComfyUI 规范').enabled).toBe(false);
  });

  it('NAI 后端 + 4 系模型:启用单串 tag 那一对(下线模型的存量设置会被改成默认模型,故直接测工厂)', async () => {
    const { defaultPromptPreset } = await import('@/state/settings');
    const preset = defaultPromptPreset('nai', 'nai-diffusion-4-full');
    expect(blockNamed(preset, 'NAI 规范(4 系)').enabled).toBe(true);
    expect(blockNamed(preset, 'NAI 思维链(4 系)').enabled).toBe(true);
    expect(blockNamed(preset, 'NAI 规范').enabled).toBe(false);
    expect(blockNamed(preset, 'ComfyUI 规范').enabled).toBe(false);
  });

  it('存着已下线的 NAI 模型时,模型被退役迁移改写 → 启用的是 V5 那一对', async () => {
    const settings = await hydrateWith({
      defaultBackend: 'nai',
      nai: { model: 'nai-diffusion-4-full' },
      autoTag: {},
    });
    expect(settings.nai.model).not.toBe('nai-diffusion-4-full');
    const preset = settings.autoTag.promptConfig!.presets[0];
    expect(blockNamed(preset, 'NAI 规范').enabled).toBe(true);
    expect(blockNamed(preset, 'NAI 规范(4 系)').enabled).toBe(false);
  });

  it('合并开关默认:相邻合并开、合并 System/User 关', async () => {
    const settings = await hydrateWith({ autoTag: {} });
    expect(settings.autoTag.promptConfig!.mergeAdjacent).toBe(true);
    expect(settings.autoTag.promptConfig!.mergeSystemUser).toBe(false);
  });

  it('已有 promptConfig 时不被旧字段覆盖,老字段改了也不动块', async () => {
    const settings = await hydrateWith({
      autoTag: {
        prompts: { jailbreak: '旧字段' },
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              blocks: [{ id: 'b1', name: '破限词', role: 'system', content: '块里的内容', enabled: true }],
            },
          ],
          activePresetId: 'bbi_default',
          mergeAdjacent: false,
          mergeSystemUser: true,
          schema: 1,
        },
      },
    });
    const config = settings.autoTag.promptConfig!;
    expect(config.presets[0].blocks).toHaveLength(1);
    expect(config.presets[0].blocks[0].content).toBe('块里的内容');
    expect(config.mergeAdjacent).toBe(false);
    expect(config.mergeSystemUser).toBe(true);
  });

  it('默认预设被删掉时补回来,并排在第一位', async () => {
    const settings = await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [{ id: 'p_other', name: '分享预设', blocks: [] }],
          activePresetId: 'p_other',
          schema: 1,
        },
      },
    });
    const config = settings.autoTag.promptConfig!;
    expect(config.presets.map(p => p.id)).toEqual(['bbi_default', 'p_other']);
    // 当前预设仍指向用户选的那个
    expect(config.activePresetId).toBe('p_other');
  });

  it('activePresetId 指向不存在的预设时回落到第一个', async () => {
    const settings = await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [{ id: 'p1', name: 'P1', blocks: [] }],
          activePresetId: '不存在的 id',
          schema: 1,
        },
      },
    });
    expect(settings.autoTag.promptConfig!.activePresetId).not.toBe('不存在的 id');
  });

  it('脏数据清洗:非法角色回落 system、enabled 非布尔回落 true、内容非字符串回落空串', async () => {
    const settings = await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              blocks: [
                { id: 'b1', name: 'A', role: 'tool', content: 'x', enabled: 'yes' },
                { id: 'b2', name: 'B', role: 'user', content: 123, enabled: false },
                'junk',
              ],
            },
          ],
          activePresetId: 'bbi_default',
          schema: 1,
        },
      },
    });
    const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].role).toBe('system');
    expect(blocks[0].enabled).toBe(true);
    expect(blocks[1].content).toBe('');
    expect(blocks[1].enabled).toBe(false);
  });

  it('只有协议块保留 builtin 标记', async () => {
    const settings = await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              blocks: [
                { id: 'b1', name: '协议', role: 'system', content: 'x', enabled: true, builtin: 'contract' },
                { id: 'b2', name: '别的', role: 'system', content: 'y', enabled: true, builtin: 'contract' },
                { id: 'b3', name: '幽灵', role: 'system', content: 'z', enabled: true, builtin: 'nonsense' },
              ],
            },
          ],
          activePresetId: 'bbi_default',
          schema: 1,
        },
      },
    });
    const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
    // 清洗层保留契约块标记;组件层只对名字/位置做判定,这里只要求非法值不落库
    expect(blocks[2].builtin).toBeUndefined();
    expect(blocks[0].builtin).toBe('contract');
  });

  it('老设置物化后立即回写,换设备打开不会得到另一份现场物化', async () => {
    await hydrateWith({ autoTag: { prompts: { jailbreak: '迁移前' } } });
    const written = mocks.context?.extensionSettings?.baibai_image as {
      autoTag?: { promptConfig?: { presets?: Array<{ blocks?: unknown[] }> } };
    };
    expect(written?.autoTag?.promptConfig?.presets?.[0]?.blocks).toHaveLength(18);
  });

  it('设置里已有 promptConfig 时原样保留,不被默认预设顶替', async () => {
    await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [{ id: 'bbi_default', name: '我改过的默认预设', blocks: [] }],
          activePresetId: 'bbi_default',
          schema: 1,
        },
      },
    });
    const written = mocks.context?.extensionSettings?.baibai_image as {
      autoTag?: { promptConfig?: { presets?: Array<{ name?: string; blocks?: unknown[] }> } };
    };
    const preset = written?.autoTag?.promptConfig?.presets?.[0];
    expect(preset?.name).toBe('我改过的默认预设');
    expect(preset?.blocks ?? []).toHaveLength(0);
  });

  // 预填充联动已整体删除。旧数据里可能留着 builtin:'prefill'(以及 0.4.x 的固定 id),
  // 迁移要做三件事:摘掉标记、**不动位置/角色**、把开关按"迁移当下的实际生效状态"落定。
  it('旧预填充标记降级为普通块:不锁角色、不挪位置、开关按迁移当下生效状态落定', async () => {
    const settings = await hydrateWith({
      // 渠道的「发送预填充」当年是 false:那次升级前这个块其实一直没发出去,
      // 迁移后必须落成"关",否则升级瞬间会突然多出一段 <thinking>。
      channels: [{ id: 'ch1', name: 'C', prefill: false }],
      assignments: { tagGen: 'ch1' },
      autoTag: {
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              // 手改坏的样子:预填充排在最前、标记还在、角色是 system
              blocks: [
                { id: 'blk_prefill', name: '预填充', role: 'system', content: '<thinking>', enabled: true, builtin: 'prefill' },
                { id: 'b1', name: '破限', role: 'system', content: 'x', enabled: true },
              ],
            },
          ],
          activePresetId: 'bbi_default',
          schema: 1,
        },
      },
    });
    const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
    // 位置与角色原样保留(不再钉末位、不再锁 assistant)
    expect(blocks.map(b => b.id)).toEqual(['blk_prefill', 'b1']);
    expect(blocks[0].builtin).toBeUndefined();
    expect(blocks[0].role).toBe('system');
    // 开关继承渠道当年的实际生效状态
    expect(blocks[0].enabled).toBe(false);
  });

  it('渠道当年开着预填充(或跟随主 API)时,旧标记块迁移后仍为开', async () => {
    for (const raw of [
      { channels: [{ id: 'ch1', name: 'C', prefill: true }], assignments: { tagGen: 'ch1' } },
      { channels: [], assignments: { tagGen: '' } },
    ]) {
      vi.resetModules();
      const settings = await hydrateWith({
        ...raw,
        autoTag: {
          promptConfig: {
            presets: [
              {
                id: 'bbi_default',
                name: '柏宝绘默认',
                blocks: [
                  { id: 'blk_prefill', name: '预填充', role: 'assistant', content: '<thinking>', enabled: true, builtin: 'prefill' },
                ],
              },
            ],
            activePresetId: 'bbi_default',
            schema: 1,
          },
        },
      });
      const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
      expect(blocks[0].builtin).toBeUndefined();
      expect(blocks[0].enabled).toBe(true);
    }
  });

  /**
   * 幂等性回归:旧版本的 normalize 会按 id 把 builtin:'prefill' **补回来**
   * (`else if (block.id === 'blk_prefill') block.builtin = 'prefill'`),而渠道上的 prefill 键
   * 早被新版本清掉了。若此时还"按实际生效状态落定",就会拿一个看不见的渠道默认成开,
   * 把用户已经落定(或后来自己改过)的开关强行改回开 —— 实测在用户的真实数据上踩到过。
   */
  it('遗留信号已丢失(渠道里没有 prefill 键)时不碰块的开关,只摘标记', async () => {
    const settings = await hydrateWith({
      // 渠道里已无 prefill 键(已被新版本清掉),但块上又被旧版本补回了标记
      channels: [{ id: 'ch1', name: 'C' }],
      assignments: { tagGen: 'ch1' },
      autoTag: {
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              blocks: [
                { id: 'blk_prefill', name: '预填充', role: 'assistant', content: '<thinking>', enabled: false, builtin: 'prefill' },
              ],
            },
          ],
          activePresetId: 'bbi_default',
          schema: 1,
        },
      },
    });
    const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
    expect(blocks[0].builtin).toBeUndefined();
    // 保持用户存下来的 false,不被"看不见的渠道"改成 true
    expect(blocks[0].enabled).toBe(false);
  });

  it('手改出多个旧标记块:各自降级,顺序原样保留(不再去重、不再挪位)', async () => {
    const settings = await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [
            {
              id: 'bbi_default',
              name: '柏宝绘默认',
              blocks: [
                { id: 'a', name: 'A', role: 'assistant', content: 'a', enabled: true, builtin: 'prefill' },
                { id: 'b', name: 'B', role: 'system', content: 'b', enabled: true },
                { id: 'c', name: 'C', role: 'assistant', content: 'c', enabled: true, builtin: 'prefill' },
              ],
            },
          ],
          activePresetId: 'bbi_default',
          schema: 1,
        },
      },
    });
    const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
    expect(blocks.map(b => b.id)).toEqual(['a', 'b', 'c']);
    expect(blocks.every(b => b.builtin === undefined)).toBe(true);
  });

  it('出厂默认预设的预填充块已无标记,但仍在最后且默认开启', async () => {
    const settings = await hydrateWith({ autoTag: {} });
    const blocks = settings.autoTag.promptConfig!.presets[0].blocks;
    const prefill = blocks[blocks.length - 1];
    // 块 id 是每次物化新生成的(默认预设已改为数据驱动,不再有 0.4.x 那套固定 id)
    expect(prefill.name).toBe('预填充');
    expect(prefill.builtin).toBeUndefined();
    expect(prefill.role).toBe('assistant');
    expect(prefill.enabled).toBe(true);
  });

  it('showMoveButtons 默认关,存过的值被尊重', async () => {
    const fresh = await hydrateWith({ autoTag: {} });
    expect(fresh.autoTag.promptConfig!.showMoveButtons).toBe(false);

    vi.resetModules();
    const kept = await hydrateWith({
      autoTag: {
        promptConfig: {
          presets: [{ id: 'bbi_default', name: 'P', blocks: [] }],
          activePresetId: 'bbi_default',
          showMoveButtons: true,
          schema: 1,
        },
      },
    });
    expect(kept.autoTag.promptConfig!.showMoveButtons).toBe(true);
  });
});
