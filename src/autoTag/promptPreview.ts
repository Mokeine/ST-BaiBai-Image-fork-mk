import { readBookMemory } from '@/autoTag/bookMemory';
import { resolveCharAnchors } from '@/autoTag/charAnchors';
import { prepareTargetText } from '@/autoTag/clean';
import { buildAutoTagAssembly, type PromptAssembly } from '@/autoTag/prompt';
import { charTagsBeforeFloor, lockedCharTagNames } from '@/state/charTags';
import { getTagGenChannel, settings } from '@/state/settings';
import { getContext } from '@/st/context';

/**
 * 设置页的「预览」:用**当前聊天**走一遍真实装配,把最终会发出去的内容摊开给人看。
 *
 * 三条纪律:
 * - **纯本地**:不求任何 LLM,不写请求历史,不消耗额度,也不改任何数据
 *   (只看角色库与柏宝书记忆,与真正生成时同一个来源)。
 * - 目标楼默认取当前聊天**最后一楼**;调用方也可以指定别的楼层(预设作者常要看不同楼层)。
 * - 拿不到聊天/楼层时返回错误文案,**不渲染半成品** —— 半截预览比没有预览更容易误导。
 */

export interface PromptPreviewOk {
  ok: true;
  floor: number;
  /** 当前聊天总层数,便于 UI 提示可预览范围。 */
  floorCount: number;
  assembly: PromptAssembly;
  /** 非阻断警告:照这样发出去会出问题,但不拦着用户。 */
  warnings: string[];
  /** 「生成 tag」实际走的出口:副 API 渠道名;null = 跟随主 API。 */
  channelName: string | null;
}

export interface PromptPreviewFail {
  ok: false;
  error: string;
}

export type PromptPreviewOutcome = PromptPreviewOk | PromptPreviewFail;

/** 照这样发出去会出问题的地方。只提醒,不拦。 */
export function collectPreviewWarnings(assembly: PromptAssembly): string[] {
  const warnings: string[] = [];
  const live = assembly.blocks.filter(b => !b.skipped);
  if (!live.length) {
    warnings.push('没有任何可发送的消息块(全部停用或内容为空),实际生成会直接报错。');
    return warnings;
  }
  // 示例 JSON 是解析端的前提:没有任何块输出它,模型就不知道要写什么结构
  const shapeBlocks = live.filter(b => b.vars.includes('output_shape'));
  if (!shapeBlocks.length) {
    warnings.push(
      '没有任何消息块输出示例 JSON({{output_shape}}),模型不会知道该返回什么结构,自动配图会解析失败。',
    );
  }
  // 花括号残留:插件变量与酒馆宏都展完之后还留着的 {{...}},会**原样**发给模型。
  // 扫描的是**展宏后的正文**,所以两种成因都会被抓到,也不会把"本来就会被展宏的写法"误报:
  // - 插件变量拼错({{char_libary}});
  // - 像酒馆宏但没被展开(拼错、参数不合法 —— 例如 roll 算式非法时 ST 会返回空串,不留残留)。
  const leftovers = new Set<string>();
  for (const block of live) {
    for (const found of block.text.match(/\{\{[\s\S]{0,120}?\}\}/g) ?? []) {
      leftovers.add(found.replace(/\s+/g, ' '));
    }
  }
  if (leftovers.size) {
    const shown = [...leftovers].slice(0, 8).join('、');
    const more = leftovers.size > 8 ? ` 等 ${leftovers.size} 处` : '';
    warnings.push(
      `这些花括号写法会**原样**发给模型(插件变量与酒馆宏都没展开):${shown}${more}。` +
        '插件变量请对照下方变量清单检查拼写;酒馆宏请检查拼写与参数。',
    );
  }
  // 每次取值都可能不同的宏:预览显示的是这一次的值,实际发送时会重新取值
  const volatile = new Set<string>();
  for (const block of live) for (const macro of block.volatileMacros) volatile.add(macro);
  if (volatile.size) {
    warnings.push(
      `以下宏每次生成都会重新取值,预览里看到的是**这一次**的结果:${[...volatile].join('、')}。`,
    );
  }
  if (!live.some(b => b.role === 'user')) {
    warnings.push('没有任何 user 消息块,部分端点会拒绝这种请求。');
  }
  return warnings;
}

export async function buildPromptPreview(floor?: number): Promise<PromptPreviewOutcome> {
  const context = getContext();
  if (!context || !Array.isArray(context.chat) || !context.chat.length) {
    return { ok: false, error: '请先打开一个聊天再预览。' };
  }
  const floorCount = context.chat.length;
  const target = typeof floor === 'number' ? Math.floor(floor) : floorCount - 1;
  if (!Number.isFinite(target) || target < 0 || target >= floorCount) {
    return { ok: false, error: `第 ${floor} 楼不存在(当前聊天共 ${floorCount} 层)。` };
  }
  const source = context.chat[target]?.mes ?? '';
  if (!source.trim()) {
    return { ok: false, error: `第 ${target} 楼正文是空的,没有可预览的目标正文。` };
  }
  const preparedTarget = prepareTargetText(source, settings.excludes.customStripTags);
  if (!preparedTarget.segments.length) {
    return {
      ok: false,
      error: `第 ${target} 楼正文清洗后没剩下叙事内容(可能被「剔除标签」名单或思维链/注释规则全删了)。`,
    };
  }
  const memory = readBookMemory(target, source, context.name1);
  const lockedNames = lockedCharTagNames();
  // 与自动流程同口径取库;单槽重写的「任务备注」是生成当下才有的上下文,预览一律按空处理
  const anchors = resolveCharAnchors(charTagsBeforeFloor(target), lockedNames);
  const assembly = await buildAutoTagAssembly(
    context,
    target,
    settings.autoTag,
    memory,
    preparedTarget,
    anchors.text,
    '',
  );
  // 出口只用来显示渠道名;消息内容与装配结果一一对应,发送侧不会再动任何一条消息。
  const channel = getTagGenChannel();
  return {
    ok: true,
    floor: target,
    floorCount,
    assembly,
    warnings: collectPreviewWarnings(assembly),
    channelName: channel ? channel.name || channel.model || '(未命名渠道)' : null,
  };
}
