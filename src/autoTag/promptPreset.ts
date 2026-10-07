import { randomUuid } from '@/randomUuid';
import {
  DEFAULT_CONTRACT_TEMPLATE,
  type AutoTagPromptBlock,
  type AutoTagPromptConfig,
  type AutoTagPromptPreset,
  type PromptRole,
} from '@/state/settings';

/**
 * 预设的纯逻辑:新建、导出负载、以及**读取智绘姬(st-chatu8)的上下文提示词预设**。
 * 交互与落盘留在设置页组件里,与画师串库(naiArtistLib)同一分工。
 */

export const PROMPT_ROLE_LABELS: Record<PromptRole, string> = {
  system: 'SYSTEM',
  user: 'USER',
  assistant: 'ASSISTANT',
};

export const PROMPT_ROLES: readonly PromptRole[] = ['system', 'user', 'assistant'];

export function newPromptBlock(role: PromptRole = 'system', name = '新消息块'): AutoTagPromptBlock {
  return { id: `blk_${randomUuid()}`, name, role, content: '', enabled: true };
}

export function newPromptPreset(
  name: string,
  blocks: AutoTagPromptBlock[] = [],
): AutoTagPromptPreset {
  return { id: `preset_${randomUuid()}`, name, blocks };
}

/**
 * 另存为:内容照抄,预设 id 与**每个块的 id** 都换新。
 * 块 id 是拖拽/编辑的定位键,复制出来的预设必须与源预设互不影响。
 */
export function clonePreset(preset: AutoTagPromptPreset, name: string): AutoTagPromptPreset {
  return {
    id: `preset_${randomUuid()}`,
    name,
    blocks: preset.blocks.map(block => ({ ...block, id: `blk_${randomUuid()}` })),
  };
}

/** 「固定输出协议」块的逐块恢复:内容回到当前版本的默认模板。 */
export function restoreContractContent(block: AutoTagPromptBlock): void {
  block.content = DEFAULT_CONTRACT_TEMPLATE;
}

/* ============ 导出(柏宝绘自有格式,自包含) ============ */

export const PROMPT_PRESET_EXPORT_FORMAT = 'baibai-prompt-presets';
export const PROMPT_PRESET_EXPORT_VERSION = 1;

export interface PromptPresetExportBlock {
  name: string;
  role: PromptRole;
  content: string;
  enabled: boolean;
  /**
   * 内置标记(目前只有 `contract`)。
   * 必须一起导出:不带它,导入回来的「固定输出协议」就失去了「恢复内置默认」能力 ——
   * 而预设本来就是拿来来回导出/导入的东西。老文件没有这个键 → 视为普通块。
   */
  builtin?: 'contract';
}

export interface PromptPresetExport {
  format: string;
  version: number;
  /**
   * 作者当时的合并开关。**导入方只作参考,不覆盖本地全局设置** ——
   * 合并是全局行为,被一份预设悄悄改掉会很难排查。
   */
  mergeAdjacent: boolean;
  mergeSystemUser: boolean;
  presets: Array<{ name: string; blocks: PromptPresetExportBlock[] }>;
}

export function buildExportPayload(
  presets: readonly AutoTagPromptPreset[],
  config: Pick<AutoTagPromptConfig, 'mergeAdjacent' | 'mergeSystemUser'>,
): PromptPresetExport {
  return {
    format: PROMPT_PRESET_EXPORT_FORMAT,
    version: PROMPT_PRESET_EXPORT_VERSION,
    mergeAdjacent: config.mergeAdjacent,
    mergeSystemUser: config.mergeSystemUser,
    presets: presets.map(preset => ({
      name: preset.name,
      blocks: preset.blocks.map(block => {
        const out: PromptPresetExportBlock = {
          name: block.name,
          role: block.role,
          content: block.content,
          enabled: block.enabled,
        };
        if (block.builtin) out.builtin = block.builtin;
        return out;
      }),
    })),
  };
}

/** 单预设与全量导出的文件名(去掉路径非法字符)。 */
export function presetFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'preset';
  return `baibai-prompt-${safe}.json`;
}

export function allPresetsFileName(): string {
  return 'baibai-prompt-presets.json';
}

/* ============ 导入:智绘姬的上下文提示词预设 ============ */

/**
 * 智绘姬的导出形状(单预设导出与「导出全部」同一形状,只是键数不同):
 *   { "预设名": { entries: [ { name, role, content, enabled, triggerMode, ... } ] } }
 * 只读这一种形状。世界书形态({worldBooks:[...]})与其余字段一律丢弃(用户明确要求)。
 *
 * 触发模式(triggerMode === 'trigger')的条目导入为**停用**:我们没有触发词能力,
 * 照搬 enabled=true 会让原本按关键词才发的内容变成常开,静默改变行为。
 */
export interface Chatu8ImportPreset {
  name: string;
  blocks: AutoTagPromptBlock[];
  /** 因原本是触发模式而被置为停用的条目数。 */
  disabledByTrigger: number;
}

export interface Chatu8ImportPlan {
  presets: Chatu8ImportPreset[];
  /** 跳过/丢弃的内容摘要,给预览弹窗显示。 */
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseChatu8Presets(raw: unknown): Chatu8ImportPlan {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { presets: [], warnings: ['文件不是智绘姬的上下文预设格式(应为 { 预设名: { entries: [...] } })。'] };
  }
  const presets: Chatu8ImportPreset[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      warnings.push(`「${name}」不是预设对象,已跳过。`);
      continue;
    }
    const entries = value.entries;
    if (!Array.isArray(entries)) {
      warnings.push(`「${name}」没有 entries(可能是智绘姬的其它数据或其它格式),已丢弃。`);
      continue;
    }
    const blocks: AutoTagPromptBlock[] = [];
    let disabledByTrigger = 0;
    let invalid = 0;
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) {
        invalid += 1;
        return;
      }
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!content) {
        invalid += 1;
        return;
      }
      const role = PROMPT_ROLES.includes(entry.role as PromptRole)
        ? (entry.role as PromptRole)
        : 'system';
      const trigger = entry.triggerMode === 'trigger';
      if (trigger) disabledByTrigger += 1;
      blocks.push({
        id: `blk_${randomUuid()}`,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `消息块 ${index + 1}`,
        role,
        content,
        // 触发模式 → 停用;其余照搬(缺省视为启用)
        enabled: trigger ? false : entry.enabled !== false,
      });
    });
    if (invalid) warnings.push(`「${name}」有 ${invalid} 条空内容/无效条目已丢弃。`);
    if (!blocks.length) {
      warnings.push(`「${name}」没有可用条目,已丢弃。`);
      continue;
    }
    presets.push({ name, blocks, disabledByTrigger });
  }
  if (!presets.length && !warnings.length) warnings.push('文件里没有可导入的预设。');
  return { presets, warnings };
}

/* ============ 导入:柏宝绘自有导出格式 ============ */

/**
 * 读回**柏宝绘自己导出的**预设(`buildExportPayload` 的逆操作)。
 *
 * 与智绘姬那份的分工:那边读"别人的格式",这边读"我们自己的格式"。
 * 两边都产出同一个 Chatu8ImportPlan,好让导入弹窗与落盘逻辑完全共用。
 * `disabledByTrigger` 恒为 0 —— 我们没有触发词这个概念,自己的格式里也没有这个字段。
 */
export function parseBaibaiPresets(raw: unknown): Chatu8ImportPlan {
  const warnings: string[] = [];
  if (!isRecord(raw) || raw.format !== PROMPT_PRESET_EXPORT_FORMAT) {
    return { presets: [], warnings: ['文件不是柏宝绘的预设导出格式(缺 format 字段)。'] };
  }
  const list = Array.isArray(raw.presets) ? raw.presets : [];
  const presets: Chatu8ImportPreset[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '导入的预设';
    const rawBlocks = Array.isArray(item.blocks) ? item.blocks : [];
    const blocks: AutoTagPromptBlock[] = [];
    let invalid = 0;
    rawBlocks.forEach((entry, index) => {
      if (!isRecord(entry)) {
        invalid += 1;
        return;
      }
      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!content) {
        invalid += 1;
        return;
      }
      const block: AutoTagPromptBlock = {
        id: `blk_${randomUuid()}`,
        name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `消息块 ${index + 1}`,
        role: PROMPT_ROLES.includes(entry.role as PromptRole) ? (entry.role as PromptRole) : 'system',
        content,
        enabled: entry.enabled !== false,
      };
      // 标记只认 contract:别的值(手改文件、旧版本残留)一律丢弃
      if (entry.builtin === 'contract') block.builtin = 'contract';
      blocks.push(block);
    });
    if (invalid) warnings.push(`「${name}」有 ${invalid} 条空内容/无效块已丢弃。`);
    if (!blocks.length) {
      warnings.push(`「${name}」没有可用块,已丢弃。`);
      continue;
    }
    presets.push({ name, blocks, disabledByTrigger: 0 });
  }
  if (!presets.length && !warnings.length) warnings.push('文件里没有可导入的预设。');
  return { presets, warnings };
}

/**
 * 导入入口:按 `format` 字段分派。
 * 带 `format: 'baibai-prompt-presets'` 的走自己那份,其余一律按智绘姬的格式试。
 */
export function parsePresetFile(raw: unknown): Chatu8ImportPlan {
  if (isRecord(raw) && raw.format === PROMPT_PRESET_EXPORT_FORMAT) return parseBaibaiPresets(raw);
  return parseChatu8Presets(raw);
}

/** 同名预设(用于「是否覆盖」询问)。 */export function findPresetByName(
  presets: readonly AutoTagPromptPreset[],
  name: string,
): AutoTagPromptPreset | undefined {
  return presets.find(p => p.name === name);
}

/** 重名时给导入副本起个不撞的名字。 */
export function uniquePresetName(
  presets: readonly AutoTagPromptPreset[],
  name: string,
  suffix = '(导入)',
): string {
  if (!findPresetByName(presets, name)) return name;
  let candidate = `${name}${suffix}`;
  let seq = 2;
  while (findPresetByName(presets, candidate)) {
    candidate = `${name}${suffix}${seq}`;
    seq += 1;
  }
  return candidate;
}

/** 删除预设:默认预设不给删(返回 false 表示拒绝)。 */
export function canDeletePreset(preset: Pick<AutoTagPromptPreset, 'id'>, defaultId: string): boolean {
  return preset.id !== defaultId;
}
