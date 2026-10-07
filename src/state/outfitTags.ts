import { getContext } from '@/st/context';
import { reactive } from 'vue';

/**
 * 服装库 —— 「服装名 → 外观 tag / 状态」的字典,分**全局库**与**本聊天**两层,
 * 合并口径与角色外貌库一致:同名时本聊天条目覆盖全局。
 *
 * 与角色外貌库的分工(刻意不共用存储,也不共用字段结构):
 * - 角色库管「人长什么样」:按角色名对档,分字段,带变化史;
 * - 服装库管「这件东西长什么样」:按服装名对档,只有**外观**与**状态**两项。
 *
 * 名字从哪来:剧情变量里的装备条目名(`主角:` → `装备:` 的子键,筛 `位置: 已穿戴`)。
 * 换下的装备会从「装备」段移走,但库不受影响 —— 库是字典,装备段是当前状态,两者解耦。
 *
 * ⚠ **状态只属于本聊天**:破损/湿润是剧情状态,同一件衣服在另一个故事里是干的。
 * 所以全局库只有外观,不存状态;全局条目复制到本聊天之后才开始有状态。
 *
 * 名字即主键:逐字相等是唯一的对档依据,所以任何一层都不允许出现同名两条。
 */

export const OUTFIT_CHAT_META_KEY = 'baibai_image_outfit_tags';
export const OUTFIT_GLOBAL_SETTINGS_KEY = 'baibai_image_outfit_global';
const STORE_VERSION = 1;

export type OutfitLayer = 'chat' | 'global';

export interface OutfitEntry {
  name: string;
  /** 外观:这件服装本身的正面 tag(款式/剪裁/颜色/材质/部件)。 */
  tag: string;
  /** 状态:破损、湿润之类**当前**的穿着状态(仅本聊天层有;空串=正常)。 */
  state: string;
}

/** 合并后给 UI / 提示词用的视图条目。 */
export interface OutfitView extends OutfitEntry {
  layer: OutfitLayer;
  /** 本聊天条目与全局同名 → 以本聊天为准(UI 打「覆盖全局」标记)。 */
  overridesGlobal: boolean;
}

interface OutfitStore {
  version: number;
  entries: Array<{ name: string; tag: string; state?: string }>;
}

export const chatOutfitLib = reactive<{ entries: OutfitEntry[] }>({ entries: [] });
export const globalOutfitLib = reactive<{ entries: OutfitEntry[] }>({ entries: [] });

/** 两层合并后的视图:本聊天优先,同名全局条目不重复出现。 */
export function outfitView(): OutfitView[] {
  const globalNames = new Set(globalOutfitLib.entries.map(e => e.name));
  const chatNames = new Set(chatOutfitLib.entries.map(e => e.name));
  return [
    ...chatOutfitLib.entries.map(entry => ({
      ...entry,
      layer: 'chat' as const,
      overridesGlobal: globalNames.has(entry.name),
    })),
    // 只有本聊天没有同名条目时才露出全局那条
    ...globalOutfitLib.entries
      .filter(entry => !chatNames.has(entry.name))
      .map(entry => ({ ...entry, layer: 'global' as const, overridesGlobal: false })),
  ];
}

/** 用户手改、旧版本残留、第三方写入:一律当成不可信输入。 */
export function normalizeOutfitEntries(raw: unknown, withState: boolean): OutfitEntry[] {
  const out: OutfitEntry[] = [];
  const seen = new Set<string>();
  const push = (name: unknown, tag: unknown, state: unknown): void => {
    if (typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push({
      name: trimmed,
      tag: typeof tag === 'string' ? tag.trim() : '',
      state: withState && typeof state === 'string' ? state.trim() : '',
    });
  };
  const fromRecord = (record: Record<string, unknown>): void => {
    if (Array.isArray(record.entries)) {
      for (const item of record.entries) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entry = item as Record<string, unknown>;
          push(entry.name, entry.tag, entry.state);
        }
      }
      return;
    }
    // 退化成 { 服装名: tag } 的纯字典也认(手写元数据时最省事)
    for (const [name, tag] of Object.entries(record)) {
      if (name === 'version' || name === 'entries') continue;
      if (typeof tag === 'string') push(name, tag, '');
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entry = item as Record<string, unknown>;
        push(entry.name, entry.tag, entry.state);
      }
    }
  } else if (raw && typeof raw === 'object') {
    fromRecord(raw as Record<string, unknown>);
  }
  return out;
}

/* ============ 水合与落盘 ============ */

function extensionSettings(): Record<string, unknown> | undefined {
  return getContext()?.extensionSettings as Record<string, unknown> | undefined;
}

/** 切聊天/切分支时重新读本聊天层;全局层只在启动时读一次(它是跨聊天的)。 */
export function hydrateOutfitLibrary(): void {
  chatOutfitLib.entries = normalizeOutfitEntries(getContext()?.chatMetadata?.[OUTFIT_CHAT_META_KEY], true);
}

export function initGlobalOutfitLibrary(): void {
  globalOutfitLib.entries = normalizeOutfitEntries(extensionSettings()?.[OUTFIT_GLOBAL_SETTINGS_KEY], false);
}

function persistChat(): void {
  const context = getContext();
  if (!context?.chatMetadata) return;
  const store: OutfitStore = {
    version: STORE_VERSION,
    entries: chatOutfitLib.entries.map(e => ({ name: e.name, tag: e.tag, state: e.state })),
  };
  context.chatMetadata[OUTFIT_CHAT_META_KEY] = store;
  context.saveMetadataDebounced?.();
}

function persistGlobal(): void {
  const settings = extensionSettings();
  if (!settings) return;
  settings[OUTFIT_GLOBAL_SETTINGS_KEY] = {
    version: STORE_VERSION,
    entries: globalOutfitLib.entries.map(e => ({ name: e.name, tag: e.tag })),
  } as unknown;
  getContext()?.saveSettingsDebounced?.();
}

function libOf(layer: OutfitLayer): { entries: OutfitEntry[] } {
  return layer === 'chat' ? chatOutfitLib : globalOutfitLib;
}

function persist(layer: OutfitLayer): void {
  if (layer === 'chat') persistChat();
  else persistGlobal();
}

/* ============ CRUD ============ */

export function findOutfit(name: string, layer: OutfitLayer): OutfitEntry | undefined {
  const key = name.trim();
  return libOf(layer).entries.find(entry => entry.name === key);
}

/** 合并视图里按名字取一条(本聊天优先),用于判断"库里有没有这件"。 */
export function findOutfitAny(name: string): OutfitView | undefined {
  const key = name.trim();
  return outfitView().find(entry => entry.name === key);
}

/**
 * 新增或更新(同名即覆盖)。名字为空时忽略。
 * 外观与状态都允许暂时留空 —— 页面会标出「待补」,AI 建档时也可能先报名字后补内容。
 */
export function setOutfit(
  name: string,
  values: { tag?: string; state?: string },
  layer: OutfitLayer = 'chat',
): void {
  const key = name.trim();
  if (!key) return;
  const lib = libOf(layer);
  const existing = lib.entries.find(entry => entry.name === key);
  const tag = values.tag?.trim();
  const state = layer === 'chat' ? values.state?.trim() : undefined;
  if (existing) {
    if (tag !== undefined) existing.tag = tag;
    if (state !== undefined) existing.state = state;
  } else {
    lib.entries.push({ name: key, tag: tag ?? '', state: state ?? '' });
  }
  persist(layer);
}

export function removeOutfit(name: string, layer: OutfitLayer): void {
  const key = name.trim();
  const lib = libOf(layer);
  const index = lib.entries.findIndex(entry => entry.name === key);
  if (index < 0) return;
  lib.entries.splice(index, 1);
  persist(layer);
}

/** 改名。目标名已存在时合并(保留目标原有的非空字段),不产生同名两条。 */
export function renameOutfit(from: string, to: string, layer: OutfitLayer): void {
  const source = from.trim();
  const target = to.trim();
  if (!source || !target || source === target) return;
  const lib = libOf(layer);
  const entry = lib.entries.find(item => item.name === source);
  if (!entry) return;
  const clash = lib.entries.find(item => item.name === target);
  if (clash) {
    if (!clash.tag) clash.tag = entry.tag;
    if (layer === 'chat' && !clash.state) clash.state = entry.state;
    removeOutfit(source, layer);
    return;
  }
  entry.name = target;
  persist(layer);
}

/** 「复制到本聊天」:把全局条目的外观落到本聊天层(状态从空开始)。 */
export function copyOutfitToChat(name: string): void {
  const source = findOutfit(name, 'global');
  if (!source) return;
  setOutfit(source.name, { tag: source.tag, state: '' }, 'chat');
}

/** 「提升为全局」:外观快照进全局库,并删掉本聊天副本(状态不带走)。 */
export function promoteOutfitToGlobal(name: string): void {
  const source = findOutfit(name, 'chat');
  if (!source) return;
  setOutfit(source.name, { tag: source.tag }, 'global');
  removeOutfit(source.name, 'chat');
}

/**
 * 落库 AI 报告的服装变更。
 *
 * 报告形状与 protocol.ts 的 OutfitReport 结构一致(这里不 import 它:那是 autoTag 层,
 * 而 state 层被 autoTag 依赖,反向 import 会绕成环)。
 *
 * 语义逐条对应:
 * - `tag`/`state` **缺省 = 这一项不改动**;给了空串 = 清空(状态恢复正常时正是这么报的)。
 * - 与现有值完全相同的报告直接跳过,不写盘 —— 否则每次生成都会把元数据改脏。
 * - 一律落**本聊天层**:全局条目被 AI 更新时会在本聊天生成一条覆盖条目,
 *   这样"这个故事里变了"不会污染别的故事。
 */
export function applyOutfitReports(
  reports: readonly { name: string; tag?: string; state?: string }[],
): number {
  let applied = 0;
  for (const report of reports) {
    const name = report.name?.trim();
    if (!name) continue;
    const next: { tag?: string; state?: string } = {};
    if (report.tag !== undefined) next.tag = report.tag.trim();
    if (report.state !== undefined) next.state = report.state.trim();
    if (next.tag === undefined && next.state === undefined) continue;
    const existing = findOutfit(name, 'chat');
    const sameTag = next.tag === undefined || existing?.tag === next.tag;
    const sameState = next.state === undefined || existing?.state === next.state;
    if (existing && sameTag && sameState) continue;
    setOutfit(name, next, 'chat');
    applied += 1;
  }
  return applied;
}

/* ============ 卡片展示 ============ */

/**
 * 卡片上显示的外观 chips —— 与角色管理同款外观、不同的切分口径。
 *
 * 角色卡是按**字段**一个 chip;服装只有一个 tag 串,所以这里按**英文逗号**切:
 * - 最多取前 `maxChips` 段;
 * - **累计字符数封顶** `maxChars`:加到某段会超就不再加 —— 于是长 tag 自然显示得更少;
 * - 单段超过 `maxChipLen` 截断加 `…`(避免一段独占整行);
 * - 未显示的段数用 `+N` 提示(否则分不清"只有 4 段"还是"被截了")。
 *
 * 纯函数,便于单测;样式与尺寸在页面里(照抄角色卡)。
 */
export function outfitChips(
  tag: string,
  options: { maxChips?: number; maxChars?: number; maxChipLen?: number } = {},
): { chips: string[]; hidden: number } {
  const maxChips = options.maxChips ?? 4;
  const maxChars = options.maxChars ?? 60;
  const maxChipLen = options.maxChipLen ?? 24;
  const parts = tag
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  const chips: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (chips.length >= maxChips) break;
    // 第一段无论如何都要显示,否则长到只有一个词的 tag 会整块空白
    if (chips.length && used + part.length > maxChars) break;
    used += part.length;
    chips.push(part.length > maxChipLen ? `${part.slice(0, maxChipLen - 1)}…` : part);
  }
  return { chips, hidden: Math.max(0, parts.length - chips.length) };
}

/* ============ 注入文本 ============ */

/**
 * 注入给 AI 的库文本(两层合并后的结果)。
 *
 * 空库时**返回说明而不是空串**:块照常发送,AI 才知道机制存在 —— 与 `{{char_library}}` 同口径。
 * 有状态时拼在同一行末尾(外观在前、状态在后),这样 AI 照抄外观的同时能看到当前状态。
 */
export function outfitLibraryText(): string {
  const entries = outfitView();
  if (!entries.length) {
    return '【服装库】[system-maintained; no equipment recorded yet]\n（当前为空，尚未记录任何装备。）';
  }
  const lines = entries.map(entry => {
    const art = entry.tag ? entry.tag : '(尚无外观 tag)';
    const state = entry.state ? ` ｜ 状态: ${entry.state}` : '';
    const scope = entry.layer === 'global' ? '[global] ' : '';
    return `${scope}${entry.name}: ${art}${state}`;
  });
  return [
    '【服装库】[system-maintained; a dictionary of equipped items → appearance tags (+ current state)]',
    '（外观 tag 是这件装备本身的正面描述,衣物与武器一视同仁;剧情里出现同名装备时照抄,不得重新设计。状态是它当前的状况,正常时为空。⚠ 这只是字典,不是出场清单:画面里看不见的装备不要写进 tag。）',
    ...lines,
  ].join('\n');
}
