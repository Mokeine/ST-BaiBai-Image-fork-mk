import type { ChatMsg } from '@/api/client';
import {
  isContentVariable,
  isPromptVariableName,
  type PromptVariableName,
  type PromptVariableValues,
} from '@/autoTag/promptVars';
import type { AutoTagPromptPreset, PromptRole } from '@/state/settings';

/**
 * 消息块渲染与合并(纯逻辑,无 IO)。
 *
 * 发送路径 = 渲染每个启用的块 → 丢掉空块 → 可选把 system 降级为 user → 可选相邻同角色合并。
 * 合并开关默认:相邻合并开、system 降级关(见 settings 的 promptConfig 默认值)。
 */

/** 变量语法:{{name}},括号内允许空格;名称大小写敏感。 */
const VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * 每次调用取值都可能不同的酒馆宏:预览必须说明"这里是示例值"。
 * 详见 macros.js —— roll 走 droll.roll(每次不同),random/pick 各自抽签。
 */
const VOLATILE_MACRO_RE = /\{\{\s*(?:roll|random|pick)\b[^}]*\}\}/gi;

export interface RenderedTemplate {
  /** 渲染结果(已 trim)。 */
  text: string;
  /** 模板里引用到的、变量表内存在的名字(出现顺序,去重)。 */
  vars: PromptVariableName[];
  /** 变量表外的名字:原样保留,供 UI 提示拼写错误。 */
  unknownVars: string[];
  /** 模板里出现的「每次取值可能不同」的酒馆宏原文(去重)。预览据此提示"示例值"。 */
  volatileMacros: string[];
}

/**
 * 渲染一块模板:先展开插件自己的 {{变量}},再把结果交给酒馆展宏(substituteParams)。
 *
 * 顺序不能反:插件变量({{char_card}} 之类)酒馆不认识,先交给它只会被原样留下或吞掉;
 * 而 {{char}}/{{roll}} 这些酒馆宏在插件这边本来就匹配不到,正好留给第二遍。
 * 第二遍也解释了为什么 `{{roll 1999999}}` 现在能生效。
 */
export function renderTemplate(
  template: string,
  values: PromptVariableValues,
  expandMacros?: (text: string) => string,
): RenderedTemplate {
  const vars: PromptVariableName[] = [];
  const unknownVars: string[] = [];
  const replaced = template.replace(VAR_RE, (raw: string, name: string) => {
    if (!isPromptVariableName(name)) {
      if (!unknownVars.includes(name)) unknownVars.push(name);
      return raw;
    }
    if (!vars.includes(name)) vars.push(name);
    return values[name] ?? '';
  });
  // 酒馆展宏在插件变量之后、trim/空块判定之前:展宏后才看得出这块到底有没有内容
  const expanded = expandMacros ? expandMacros(replaced) : replaced;
  // {{nl}} 置空后会在规范里留下连续空行;按旧 backendPromptSpec 的口径折叠掉。
  // 只对引用了该宏的模板做——正文/世界书里的原始空行不得被顺手改掉。
  const text = (vars.includes('nl') ? expanded.replace(/\n{3,}/g, '\n\n') : expanded).trim();
  const volatileMacros = [...new Set((template.match(VOLATILE_MACRO_RE) ?? []).map(s => s.replace(/\s+/g, ' ')))];
  return { text, vars, unknownVars, volatileMacros };
}

/** 块被跳过的原因(预览里逐条显示)。 */
export type PromptBlockSkipReason = 'disabled' | 'empty' | 'no-content';

export const PROMPT_SKIP_LABELS: Record<PromptBlockSkipReason, string> = {
  disabled: '已停用',
  empty: '内容为空',
  'no-content': '引用的变量都没有值',
};

export interface RenderedBlock {
  id: string;
  name: string;
  role: PromptRole;
  /** 实际生效的开关(= 块自己存的值;不再有任何由外部 API 决定的块)。 */
  enabled: boolean;
  /** 渲染后的正文(已 trim)。停用块也照常渲染,预览要能看到它的内容。 */
  text: string;
  skipped: boolean;
  skipReason?: PromptBlockSkipReason;
  vars: PromptVariableName[];
  unknownVars: string[];
  /** 见 RenderedTemplate.volatileMacros —— 预览用它提示"这里显示的是示例值"。 */
  volatileMacros: string[];
  builtin?: 'contract';
}

export interface RenderBlocksOptions {
  /**
   * 酒馆展宏(substituteParams)。**在插件变量展开之后**逐块调用(顺序理由见 renderTemplate)。
   * 不传 = 不展宏(纯逻辑单测即此路径)。跟随主 API 时酒馆自己还会再展一遍,
   * 那时宏已经被展成普通文本了,第二遍是空操作。
   */
  expandMacros?: (text: string) => string;
}

/**
 * 逐块渲染。跳过判定:
 * 1. 块被停用;
 * 2. 渲染后是空串(**展宏之后**判定:一个只剩 {{roll}} 的块展宏后就不空了);
 * 3. 块引用了内容变量、但这些变量**全部**没有值(旧版「抓不到角色卡就不发那条」的口径)。
 *    片段宏({{nl}})不参与第 3 条,否则关掉自然语言会连整份规范一起吞掉。
 *
 * 曾经还有一条"预填充块随渠道的「发送预填充」停用"(跳过理由 'api-off'),那套联动已删除:
 * 发不发只看块自己的开关。
 */
export function renderPresetBlocks(
  preset: AutoTagPromptPreset,
  values: PromptVariableValues,
  options: RenderBlocksOptions = {},
): RenderedBlock[] {
  return preset.blocks.map(block => {
    const { text, vars, unknownVars, volatileMacros } = renderTemplate(
      block.content,
      values,
      options.expandMacros,
    );
    const contentVars = vars.filter(name => isContentVariable(name));
    const noContent =
      contentVars.length > 0 && contentVars.every(name => !(values[name] ?? '').trim());
    let skipReason: PromptBlockSkipReason | undefined;
    if (!block.enabled) skipReason = 'disabled';
    else if (!text) skipReason = 'empty';
    else if (noContent) skipReason = 'no-content';
    const rendered: RenderedBlock = {
      id: block.id,
      name: block.name,
      role: block.role,
      enabled: block.enabled,
      text,
      skipped: skipReason !== undefined,
      vars,
      unknownVars,
      volatileMacros,
    };
    if (skipReason !== undefined) rendered.skipReason = skipReason;
    if (block.builtin) rendered.builtin = block.builtin;
    return rendered;
  });
}

export interface PromptMergeOptions {
  mergeAdjacent: boolean;
  mergeSystemUser: boolean;
}

/**
 * 相邻同角色合并。两条之间补一个空行:块本身就是段落,旧版把 user 侧多段
 * 拼成一条时用的也正是空行,这样「默认预设 + 合并开」与旧版发出的 user 内容逐字节一致。
 */
export function mergeAdjacentMessages(messages: readonly ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role) last.content = `${last.content}\n\n${msg.content}`;
    else out.push({ ...msg });
  }
  return out;
}

export function assembleMessages(
  blocks: readonly RenderedBlock[],
  options: PromptMergeOptions,
): ChatMsg[] {
  const live = blocks.filter(b => !b.skipped);
  const mapped: ChatMsg[] = live.map(b => ({
    role: options.mergeSystemUser && b.role === 'system' ? 'user' : b.role,
    content: b.text,
  }));
  return options.mergeAdjacent ? mergeAdjacentMessages(mapped) : mapped;
}
