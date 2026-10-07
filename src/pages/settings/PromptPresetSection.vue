<script setup lang="ts">
import BbiSelect from '@/components/BbiSelect.vue';
import Collapsible from '@/components/Collapsible.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { buildPromptPreview, type PromptPreviewOutcome } from '@/autoTag/promptPreview';
import PromptBlockEditor from '@/pages/settings/PromptBlockEditor.vue';
import PromptPreviewDialog from '@/pages/settings/PromptPreviewDialog.vue';
import {
  allPresetsFileName,
  buildExportPayload,
  canDeletePreset,
  clonePreset,
  findPresetByName,
  newPromptBlock,
  newPromptPreset,
  parsePresetFile,
  presetFileName,
  uniquePresetName,
  type Chatu8ImportPreset,
} from '@/autoTag/promptPreset';
import { PROMPT_VARIABLE_NOTES, PROMPT_VARIABLES, type PromptVarMeta } from '@/autoTag/promptVars';
import {
  DEFAULT_PROMPT_PRESET_ID,
  DEFAULT_PROMPT_PRESET_NAME,
  PROMPT_CONFIG_SCHEMA,
  defaultPromptPreset,
  settings,
  type AutoTagPromptBlock,
  type AutoTagPromptConfig,
  type PromptRole,
} from '@/state/settings';
import { DEFAULT_PRESET_BLOCKS } from '@/state/defaultPreset';
import { modalHost } from '@/state/ui';
import { ROUGH_TOKEN_HINT as TOKEN_HINT, roughTokenLabel as tokenLabel } from '@/tokens';
import { computed, nextTick, ref } from 'vue';

/**
 * 「自定义提示词」模块:把原来 6 个固定字段换成可自由排列的消息块。
 *
 * 与智绘姬 LLM 选项卡的「上下文配置」同构,外观沿用本插件既有主题:
 * - 预设级:选择 / 新建 / 另存为 / 重命名 / 导入 / 导出 / 导出全部 / 删除 / 恢复默认;
 * - 块级:开关、编辑(宽弹窗)、删除、上移下移 + 桌面拖拽;
 * - 底部:合并开关、可用变量清单(默认收起)、预览(点击才渲染)。
 *
 * **没有「保存」按钮**:本插件设置是 reactive + 自动落盘,改动即时保存,
 * 摆一个只会让人以为不点就丢。
 */
const ROLE_LABELS: Record<PromptRole, string> = {
  system: 'SYSTEM',
  user: 'USER',
  assistant: 'ASSISTANT',
};

/** 兜底:normalize 保证设置里一定有 promptConfig;真缺了就现建一份,免得整块 UI 空转。 */
function ensureConfig(): AutoTagPromptConfig {
  if (!settings.autoTag.promptConfig) {
    settings.autoTag.promptConfig = {
      presets: [
        defaultPromptPreset(settings.defaultBackend, settings.nai.model),
      ],
      activePresetId: DEFAULT_PROMPT_PRESET_ID,
      mergeAdjacent: true,
      mergeSystemUser: false,
      showMoveButtons: false,
      schema: PROMPT_CONFIG_SCHEMA,
    };
  }
  return settings.autoTag.promptConfig;
}
ensureConfig();

const config = computed(() => ensureConfig());
const presets = computed(() => config.value.presets);
const active = computed(
  () => presets.value.find(p => p.id === config.value.activePresetId) ?? presets.value[0],
);
const presetOptions = computed(() => presets.value.map(p => ({ value: p.id, label: p.name })));
const isDefaultPreset = computed(() => active.value.id === DEFAULT_PROMPT_PRESET_ID);

const variableGroups = computed(() => {
  const groups: { name: string; items: PromptVarMeta[] }[] = [];
  for (const item of PROMPT_VARIABLES) {
    let group = groups.find(g => g.name === item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
});

/** 行内预览:取第一行非空文本,超长交给 CSS 省略号 */
function inline(text: string): string {
  return (text.split('\n').find(line => line.trim()) ?? '').trim();
}

/**
 * 变量在界面上的写法。放在脚本里而不是模板里拼:模板插值里出现 `{{`/`}}`
 * 会让 Vue 的模板解析器提前收尾(踩过一次构建失败)。
 */
function varToken(name: string): string {
  return `{{${name}}}`;
}

/* ============ 块操作 ============ */

const editorOpen = ref(false);
const editing = ref<AutoTagPromptBlock | null>(null);

/** 全部块都在同一个可排序列表里(预填充块已降级为普通块,不再有"锁定行") */
const sortableBlocks = computed(() => active.value.blocks);

function openEditor(block: AutoTagPromptBlock): void {
  editing.value = block;
  editorOpen.value = true;
}

function applyEdit(value: { name: string; role: PromptRole; content: string }): void {
  const block = editing.value;
  if (block) {
    block.name = value.name;
    block.role = value.role;
    block.content = value.content;
  }
  editorOpen.value = false;
}

function addBlock(): void {
  const block = newPromptBlock();
  // 直接追加到末尾(不再有"必须留在最后"的锁定块);想挪位置就拖或点上下移
  active.value.blocks = [...active.value.blocks, block];
  openEditor(block);
}

const pendingRemove = ref<AutoTagPromptBlock | null>(null);
const deleteOpen = ref(false);

function askRemoveBlock(block: AutoTagPromptBlock): void {
  pendingRemove.value = block;
  deleteOpen.value = true;
}

function confirmRemoveBlock(): void {
  // 先关弹窗:ConfirmDialog 的确定键只 emit('confirm')、自己不关(全局口径见 ConfirmDialog 与
  // 设置页的 confirmRemoveChannel)。漏了这行,块其实删掉了、弹窗却一直盖在上面,看起来像没生效。
  deleteOpen.value = false;
  const block = pendingRemove.value;
  if (block) {
    const index = active.value.blocks.indexOf(block);
    if (index >= 0) active.value.blocks.splice(index, 1);
  }
  pendingRemove.value = null;
}

function toggleBlock(block: AutoTagPromptBlock): void {
  block.enabled = !block.enabled;
}

/** 写回块列表(顺序即拼装顺序;不再有需要恒排末尾的锁定块) */
function writeBlocks(list: AutoTagPromptBlock[]): void {
  active.value.blocks = [...list];
}

/** 上移/下移:直接在整份列表里换位 */
function moveBlock(block: AutoTagPromptBlock, delta: number): void {
  const list = [...active.value.blocks];
  const from = list.indexOf(block);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  writeBlocks(list);
}

/* ============ 指针拖拽排序 ============
 * 不用 HTML5 拖放,原因有三:
 * 1. `dataTransfer.setData('text/plain', index)` 会把这一格当成"一段可拖动的文字",
 *    拖到页面空白处松手就触发浏览器的"拖文字去搜索"(用户实测会跳谷歌搜 "12"/"13");
 * 2. 拖影由浏览器绘制,既不跟手也没法做让位动画;
 * 3. 触屏上 HTML5 拖放根本不触发。
 * 改为自绘:克隆一个浮层跟着指针走,其余行用 transform 让位,松手才提交顺序。
 * 触屏仍交给上移/下移按钮 —— 手机上让列表能正常滚动,比"能拖"更值钱。
 */
const listEl = ref<HTMLUListElement | null>(null);
const dragging = ref(false);
const dragIndex = ref(-1);
const dragTo = ref(-1);
/** 逐行让位位移(px),0 = 不动 */
const rowShift = ref<number[]>([]);
/** 落位的那一帧关掉过渡,避免"DOM 已换位 + transform 还在动画"造成的双影 */
const settling = ref(false);

interface DragSession {
  pointerId: number;
  from: number;
  startY: number;
  /** 起手时各行的矩形(整场不变,拿它算目标位 —— 边拖边测会被让位动画带着抖) */
  rects: DOMRect[];
  /** 行高 + 间距 */
  step: number;
  ghost: HTMLElement | null;
  started: boolean;
}
let session: DragSession | null = null;

function rowEls(): HTMLElement[] {
  const list = listEl.value;
  if (!list) return [];
  return [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
}

function shiftFor(index: number): string | undefined {
  const shift = rowShift.value[index];
  return shift ? `translateY(${shift}px)` : undefined;
}

function onRowPointerDown(event: PointerEvent, index: number): void {
  if (event.pointerType === 'touch') return; // 触屏不拖:让列表正常滚动
  if (event.button !== 0) return;
  // 按在按钮/输入框上不拖,否则点「编辑」会被当成拖拽起手
  if ((event.target as HTMLElement | null)?.closest('button, input, select, textarea, a')) return;
  const rects = rowEls().map(el => el.getBoundingClientRect());
  if (!rects.length) return;
  session = {
    pointerId: event.pointerId,
    from: index,
    startY: event.clientY,
    rects,
    step: rects.length > 1 ? rects[1].top - rects[0].top : rects[0].height + 8,
    ghost: null,
    started: false,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onRowPointerMove(event: PointerEvent): void {
  const active_session = session;
  if (!active_session || event.pointerId !== active_session.pointerId) return;
  const dy = event.clientY - active_session.startY;
  if (!active_session.started) {
    // 4px 死区:手抖不算拖拽,否则每次点击都会轻微位移
    if (Math.abs(dy) < 4) return;
    active_session.started = true;
    dragging.value = true;
    dragIndex.value = active_session.from;
    dragTo.value = active_session.from;
    startGhost(active_session);
  }
  event.preventDefault();
  if (active_session.ghost) active_session.ghost.style.transform = `translate3d(0, ${dy}px, 0)`;

  // 目标位:拿被拖那行的中心跟其余行的中线比,越过谁就插到谁那儿
  const base = active_session.rects[active_session.from];
  const centerY = base.top + base.height / 2 + dy;
  let to = active_session.from;
  for (let i = 0; i < active_session.rects.length; i += 1) {
    if (i === active_session.from) continue;
    const mid = active_session.rects[i].top + active_session.rects[i].height / 2;
    if (i < active_session.from && centerY < mid) to = Math.min(to, i);
    else if (i > active_session.from && centerY > mid) to = Math.max(to, i);
  }
  dragTo.value = to;
  applyShifts(active_session);
}

function applyShifts(s: DragSession): void {
  const shifts = new Array<number>(s.rects.length).fill(0);
  for (let i = 0; i < s.rects.length; i += 1) {
    if (i === s.from) continue;
    if (s.from < dragTo.value && i > s.from && i <= dragTo.value) shifts[i] = -s.step;
    else if (s.from > dragTo.value && i >= dragTo.value && i < s.from) shifts[i] = s.step;
  }
  rowShift.value = shifts;
}

/** 浮层宿主:modalHost 是弹窗宿主(.bbi-root 直接子级,在滚动容器外);
 *  万一它还没挂上,退回 shadow root 的宿主元素(display:contents,不影响 fixed 定位)。 */
function ghostHost(): HTMLElement | null {
  if (modalHost.value) return modalHost.value;
  const root = listEl.value?.getRootNode();
  if (root instanceof ShadowRoot) return root.host as HTMLElement;
  return root instanceof HTMLElement ? root : null;
}

function startGhost(s: DragSession): void {
  const source = rowEls()[s.from];
  const host = ghostHost();
  if (!source || !host) return;
  const rect = s.rects[s.from];
  const ghost = source.cloneNode(true) as HTMLElement;
  // 浮层必须留在 shadow root 内(挂到弹窗宿主上):挪到 document.body 会丢 --bbi-* 变量与 scoped 样式
  ghost.classList.add('bbi-drag-ghost');
  // 克隆会把源行的状态类一起带过来,其中 .is-off{opacity:.55} 的选择器权重高于 .bbi-drag-ghost,
  // 拖着一条已停用的块时浮层会变半透明、和底下的行糊成一片(实测)。这里摘掉状态类并内联定死不透明度。
  ghost.classList.remove('is-off', 'is-lifted', 'is-settling');
  ghost.style.opacity = '1';
  ghost.style.position = 'fixed';
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = '0';
  ghost.style.pointerEvents = 'none';
  // 先摆到 (0,0) 量一次:它的视口矩形就是**包含块**的偏移。
  // 不能直接写 rect.left/top 就完事 —— position:fixed 的包含块未必是视口(祖辈带 transform/
  // filter/will-change 时会变成那个祖辈),那样浮层会整体偏掉(实测左偏约 25px,徽标被切)。
  // 探一次再补偿,无论包含块是谁都对齐。
  ghost.style.visibility = 'hidden';
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  host.appendChild(ghost);
  const probe = ghost.getBoundingClientRect();
  ghost.style.left = `${rect.left - probe.left}px`;
  ghost.style.top = `${rect.top - probe.top}px`;
  ghost.style.visibility = '';
  s.ghost = ghost;
}

async function endDrag(commit: boolean): Promise<void> {
  const s = session;
  session = null;
  if (!s) return;
  if (s.ghost) s.ghost.remove();
  const from = s.from;
  const to = dragTo.value;
  const moved = commit && s.started && to >= 0 && to !== from;
  // 先关过渡再清位移 + 换位:两件事落在同一帧,视觉上块就停在让位后的位置,不会闪回
  settling.value = true;
  rowShift.value = [];
  dragging.value = false;
  dragIndex.value = -1;
  dragTo.value = -1;
  if (moved) {
    const list = [...sortableBlocks.value];
    const [picked] = list.splice(from, 1);
    list.splice(to, 0, picked);
    writeBlocks(list);
  }
  await nextTick();
  requestAnimationFrame(() => {
    settling.value = false;
  });
}

/* ============ 预设操作 ============ */

const opsOpen = ref(false);

/** 名称输入弹窗:新建 / 另存为 / 重命名共用(仓库没有现成的输入式弹窗)。 */
const nameDialog = ref<{
  open: boolean;
  title: string;
  value: string;
  apply: ((name: string) => void) | null;
}>({ open: false, title: '', value: '', apply: null });

function askName(title: string, value: string, apply: (name: string) => void): void {
  opsOpen.value = false;
  nameDialog.value = { open: true, title, value, apply };
}

function confirmName(): void {
  const { value, apply } = nameDialog.value;
  const name = value.trim();
  if (!name || !apply) return;
  apply(name);
  nameDialog.value.open = false;
  nameDialog.value.apply = null;
}

function createPreset(): void {
  askName('新建预设', '新预设', name => {
    const preset = newPromptPreset(name);
    presets.value.push(preset);
    config.value.activePresetId = preset.id;
  });
}

function duplicatePreset(): void {
  askName('另存为', `${active.value.name} 副本`, name => {
    const preset = clonePreset(active.value, name);
    presets.value.push(preset);
    config.value.activePresetId = preset.id;
  });
}

function renamePreset(): void {
  askName('重命名预设', active.value.name, name => {
    active.value.name = name;
  });
}

/** 恢复默认:只在默认预设上提供(导入的预设没有"内置默认"可言)。 */
function restoreDefaultPreset(): void {
  opsOpen.value = false;
  // 恢复的是**仓库随版本发布的那份内置提示词**,不含你的旧字段与后续改动
  active.value.blocks = defaultPromptPreset(settings.defaultBackend, settings.nai.model).blocks;
  toastr.success(`已把「${DEFAULT_PROMPT_PRESET_NAME}」恢复为仓库内置默认`, '柏宝绘');
}

const presetDeleteOpen = ref(false);

function confirmRemovePreset(): void {
  // 同上:先关弹窗,否则删完预设弹窗还挂着
  presetDeleteOpen.value = false;
  const index = presets.value.findIndex(p => p.id === active.value.id);
  if (index < 0) return;
  presets.value.splice(index, 1);
  config.value.activePresetId = presets.value[Math.min(index, presets.value.length - 1)].id;
}

/* ============ 导出 ============ */

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 立刻回收会打断部分浏览器的下载,留一点余量
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function exportActive(): void {
  opsOpen.value = false;
  downloadText(
    JSON.stringify(buildExportPayload([active.value], config.value), null, 4),
    presetFileName(active.value.name),
  );
}

function exportAll(): void {
  opsOpen.value = false;
  downloadText(
    JSON.stringify(buildExportPayload(presets.value, config.value), null, 4),
    allPresetsFileName(),
  );
}

/* ============ 导入(柏宝绘自有导出格式 + 智绘姬的上下文提示词预设) ============ */

const importInput = ref<HTMLInputElement | null>(null);
const importOpen = ref(false);
const importPlan = ref<Chatu8ImportPreset[]>([]);
const importWarnings = ref<string[]>([]);
/** 每个来件预设的处置:覆盖同名 / 另存为新名。按序号存,避免来件本身重名时串味。 */
const importChoice = ref<Record<number, 'overwrite' | 'copy'>>({});

function pickImportFile(): void {
  opsOpen.value = false;
  importInput.value?.click();
}

function onImportFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 清空 value:同一个文件改完再选一次也要能触发 change
  input.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      toastr.error('文件不是合法的 JSON。', '柏宝绘');
      return;
    }
    const plan = parsePresetFile(parsed);
    importPlan.value = plan.presets;
    importWarnings.value = plan.warnings;
    const choice: Record<number, 'overwrite' | 'copy'> = {};
    plan.presets.forEach((preset, index) => {
      choice[index] = findPresetByName(presets.value, preset.name) ? 'overwrite' : 'copy';
    });
    importChoice.value = choice;
    importOpen.value = true;
    if (!plan.presets.length) {
      for (const warning of plan.warnings) toastr.warning(warning, '柏宝绘');
    }
  };
  reader.readAsText(file);
}

function applyImport(): void {
  const plan = importPlan.value;
  let added = 0;
  let overwritten = 0;
  let disabled = 0;
  plan.forEach((incoming, index) => {
    const existing = findPresetByName(presets.value, incoming.name);
    const choice = importChoice.value[index] ?? 'copy';
    disabled += incoming.disabledByTrigger;
    if (existing && choice === 'overwrite') {
      existing.blocks = incoming.blocks;
      overwritten += 1;
      return;
    }
    const name = existing ? uniquePresetName(presets.value, incoming.name) : incoming.name;
    const preset = newPromptPreset(name, incoming.blocks);
    presets.value.push(preset);
    added += 1;
  });
  importOpen.value = false;
  importPlan.value = [];
  const parts: string[] = [];
  if (added) parts.push(`新增 ${added} 个预设`);
  if (overwritten) parts.push(`覆盖 ${overwritten} 个预设`);
  if (disabled) parts.push(`${disabled} 条原为触发词模式,已导入为停用`);
  toastr.success(parts.length ? parts.join(',') : '没有导入任何预设', '柏宝绘');
}

/* ============ 预览(点击才渲染) ============ */

const previewOpen = ref(false);
const previewLoading = ref(false);
const previewOutcome = ref<PromptPreviewOutcome | null>(null);

async function openPreview(): Promise<void> {
  previewOpen.value = true;
  previewLoading.value = true;
  previewOutcome.value = null;
  try {
    previewOutcome.value = await buildPromptPreview();
  } catch (error) {
    previewOutcome.value = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    previewLoading.value = false;
  }
}
</script>

<template>
  <Collapsible title="自定义提示词" :open="false">
    <!-- 预设选择 + 操作面板 -->
    <div class="bbi-preset-row">
      <BbiSelect
        :model-value="active.id"
        :options="presetOptions"
        aria-label="提示词预设"
        @update:model-value="config.activePresetId = $event"
      />
      <div class="bbi-preset-ops">
        <button
          class="bbi-icon-btn"
          type="button"
          title="预设操作"
          :aria-expanded="opsOpen"
          @click="opsOpen = !opsOpen"
        >
          <Icon name="settings" :size="14" />
        </button>
        <div v-if="opsOpen" class="bbi-preset-ops-panel">
          <div class="bbi-preset-ops-title">预设操作</div>
          <div class="bbi-preset-ops-grid">
            <button class="bbi-preset-ops-item" type="button" @click="createPreset">
              <Icon name="plus" /><span>新建</span>
            </button>
            <button class="bbi-preset-ops-item" type="button" @click="duplicatePreset">
              <Icon name="copy" /><span>另存为</span>
            </button>
            <button class="bbi-preset-ops-item" type="button" @click="renamePreset">
              <Icon name="edit" /><span>重命名</span>
            </button>
            <button class="bbi-preset-ops-item" type="button" @click="pickImportFile">
              <Icon name="download" /><span>导入</span>
            </button>
            <button class="bbi-preset-ops-item" type="button" @click="exportActive">
              <Icon name="upload" /><span>导出</span>
            </button>
            <button class="bbi-preset-ops-item" type="button" @click="exportAll">
              <Icon name="upload" /><span>导出全部</span>
            </button>
            <button
              v-if="isDefaultPreset"
              class="bbi-preset-ops-item"
              type="button"
              :title="`把默认预设的 ${DEFAULT_PRESET_BLOCKS.length} 个块恢复成内置默认`"
              @click="restoreDefaultPreset"
            >
              <Icon name="refresh" /><span>恢复默认</span>
            </button>
            <button
              v-if="!isDefaultPreset"
              class="bbi-preset-ops-item is-danger"
              type="button"
              @click="opsOpen = false; presetDeleteOpen = true"
            >
              <Icon name="trash" /><span>删除</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <p class="bbi-field-hint">
      改动即时保存。发送时按这里的顺序逐块渲染,变量取不到值的块自动跳过。
      默认预设不可删除(可「恢复默认」);导入认柏宝绘自己的导出文件与智绘姬「上下文配置」导出的 JSON。
    </p>

    <!-- 操作行 -->
    <div class="bbi-prompt-actions">
      <button class="bbi-btn bbi-btn-sm" type="button" @click="addBlock">
        <Icon name="plus" /> 添加消息块
      </button>
      <button class="bbi-btn bbi-btn-sm" type="button" @click="openPreview">
        <Icon name="eye" /> 预览
      </button>
    </div>

    <!-- 块列表 -->
    <ul ref="listEl" class="bbi-prompt-list" :class="{ 'is-dragging': dragging }">
      <li
        v-for="(block, index) in sortableBlocks"
        :key="block.id"
        class="bbi-prompt-item"
        :class="{
          'is-off': !block.enabled,
          'is-lifted': dragging && dragIndex === index,
          'is-settling': settling,
        }"
        :style="{ transform: shiftFor(index) }"
        @pointerdown="onRowPointerDown($event, index)"
        @pointermove="onRowPointerMove"
        @pointerup="endDrag(true)"
        @pointercancel="endDrag(false)"
      >
        <span class="bbi-prompt-role">{{ ROLE_LABELS[block.role] }}</span>
        <span class="bbi-prompt-name" :title="block.name">{{ block.name }}</span>
        <span class="bbi-prompt-preview">{{ inline(block.content) }}</span>
        <!-- 显示 token 粗估而不是字数:块与块之间要比的是"谁把提示词撑爆了"。
             字数会骗人 —— 同样 1000 字,中文约 1000 token,英文只有约 250。 -->
        <span class="bbi-prompt-len" :title="TOKEN_HINT">{{ tokenLabel(block.content) }}</span>
        <span class="bbi-block-btns">
          <button
            class="bbi-toggle bbi-toggle-sm"
            :class="{ 'is-on': block.enabled }"
            type="button"
            role="switch"
            :aria-checked="block.enabled"
            :title="block.enabled ? '点击停用' : '点击启用'"
            @click="toggleBlock(block)"
          >
            <span class="bbi-toggle-knob"></span>
          </button>
          <template v-if="config.showMoveButtons">
            <button class="bbi-icon-mini bbi-icon-xs" type="button" title="上移" @click="moveBlock(block, -1)">
              <Icon name="chevron" class="bbi-flip" />
            </button>
            <button class="bbi-icon-mini bbi-icon-xs" type="button" title="下移" @click="moveBlock(block, 1)">
              <Icon name="chevron" />
            </button>
          </template>
          <button class="bbi-icon-mini bbi-icon-xs" type="button" title="编辑" @click="openEditor(block)">
            <Icon name="edit" />
          </button>
          <button
            class="bbi-icon-mini bbi-icon-xs is-danger"
            type="button"
            title="删除"
            @click="askRemoveBlock(block)"
          >
            <Icon name="trash" />
          </button>
        </span>
      </li>
    </ul>
    <p v-if="!active.blocks.length" class="bbi-field-hint">
      这个预设还没有消息块。用「添加消息块」建一条,或「另存为」复制现有预设再改。
    </p>

    <!-- 合并设置(全局) -->
    <div class="bbi-merge-box">
      <label class="bbi-switch-row">
        <span class="bbi-field-label">显示位置调整按钮</span>
        <input v-model="config.showMoveButtons" type="checkbox" class="bbi-checkbox" />
      </label>
      <p class="bbi-field-hint">
        默认关:每行只留 开关 / 编辑 / 删除,排序靠拖拽。触屏上拖拽不生效
        (手指要先能滚动列表),手机端要排序就把这个打开。
      </p>
      <label class="bbi-switch-row">
        <span class="bbi-field-label">相邻同角色合并</span>
        <input v-model="config.mergeAdjacent" type="checkbox" class="bbi-checkbox" />
      </label>
      <p class="bbi-field-hint">
        默认开:连续的 system(或 user)块并成一条消息,之间隔一个空行 —— 旧版就是这个形态。
        关掉则每块各发一条。
      </p>
      <label class="bbi-switch-row">
        <span class="bbi-field-label">合并 System 和 User</span>
        <input v-model="config.mergeSystemUser" type="checkbox" class="bbi-checkbox" />
      </label>
      <p class="bbi-field-hint">默认关。开启后所有 system 块按 user 发送,再参与上面的相邻合并。</p>
    </div>

    <!-- 可用变量(默认收起) -->
    <Collapsible title="可用变量" :open="false">
      <div v-for="group in variableGroups" :key="group.name" class="bbi-var-group">
        <div class="bbi-var-group-title">{{ group.name }}</div>
        <ul class="bbi-var-list">
          <li v-for="item in group.items" :key="item.name" class="bbi-var-item">
            <code class="bbi-var-name">{{ varToken(item.name) }}</code>
            <span class="bbi-var-label">{{ item.label }}</span>
            <span class="bbi-var-desc">{{ item.desc }}</span>
          </li>
        </ul>
      </div>
      <p v-for="(note, i) in PROMPT_VARIABLE_NOTES" :key="i" class="bbi-field-hint">{{ note }}</p>
    </Collapsible>

    <input
      ref="importInput"
      class="bbi-hidden-input"
      type="file"
      accept=".json,application/json"
      @change="onImportFile"
    />

    <!-- ===== 消息块编辑弹窗 ===== -->
    <PromptBlockEditor
      :open="editorOpen"
      :block="editing"
      @save="applyEdit"
      @close="editorOpen = false"
    />

    <!-- ===== 预览弹窗 ===== -->
    <PromptPreviewDialog
      :open="previewOpen"
      :loading="previewLoading"
      :outcome="previewOutcome"
      @close="previewOpen = false"
    />

    <!-- ===== 名称输入弹窗 ===== -->
    <ModalMask :open="nameDialog.open" @close="nameDialog.open = false">
      <div v-if="nameDialog.open" class="bbi-modal" role="dialog" aria-modal="true" aria-label="预设名称">
        <header class="bbi-modal-head">
          <span class="bbi-modal-title">{{ nameDialog.title }}</span>
          <button class="bbi-icon-mini" type="button" title="关闭" @click="nameDialog.open = false">
            <Icon name="close" />
          </button>
        </header>
        <input
          v-model="nameDialog.value"
          class="bbi-input"
          type="text"
          placeholder="预设名称"
          spellcheck="false"
          @keydown.enter="confirmName"
        />
        <footer class="bbi-modal-foot">
          <span class="bbi-modal-foot-spacer"></span>
          <button class="bbi-btn" type="button" @click="nameDialog.open = false">取消</button>
          <button class="bbi-btn bbi-btn-primary" type="button" @click="confirmName">确定</button>
        </footer>
      </div>
    </ModalMask>

    <!-- ===== 导入预览弹窗 ===== -->
    <ModalMask :open="importOpen" @close="importOpen = false">
      <div v-if="importOpen" class="bbi-modal bbi-modal-wide" role="dialog" aria-modal="true" aria-label="导入预设">
        <header class="bbi-modal-head">
          <span class="bbi-modal-title">导入预设</span>
          <button class="bbi-icon-mini" type="button" title="关闭" @click="importOpen = false">
            <Icon name="close" />
          </button>
        </header>

        <ul v-if="importWarnings.length" class="bbi-import-warnings">
          <li v-for="(warning, i) in importWarnings" :key="i">{{ warning }}</li>
        </ul>

        <ul class="bbi-import-list">
          <li v-for="(preset, index) in importPlan" :key="index" class="bbi-import-item">
            <div class="bbi-import-name">
              {{ preset.name }}
              <span class="bbi-import-meta">
                {{ preset.blocks.length }} 块<template v-if="preset.disabledByTrigger">
                  ·{{ preset.disabledByTrigger }} 条触发词条目将导入为停用</template>
              </span>
            </div>
            <div v-if="findPresetByName(presets, preset.name)" class="bbi-import-choice">
              <label>
                <input v-model="importChoice[index]" type="radio" :value="'overwrite'" class="bbi-checkbox" />
                覆盖同名预设
              </label>
              <label>
                <input v-model="importChoice[index]" type="radio" :value="'copy'" class="bbi-checkbox" />
                另存为「{{ uniquePresetName(presets, preset.name) }}」
              </label>
            </div>
            <div v-else class="bbi-import-choice">同名预设不存在,将直接新增。</div>
          </li>
        </ul>

        <footer class="bbi-modal-foot">
          <span class="bbi-modal-foot-spacer"></span>
          <button class="bbi-btn" type="button" @click="importOpen = false">取消</button>
          <button
            class="bbi-btn bbi-btn-primary"
            type="button"
            :disabled="!importPlan.length"
            @click="applyImport"
          >
            导入 {{ importPlan.length }} 个预设
          </button>
        </footer>
      </div>
    </ModalMask>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="删除消息块"
      confirm-text="删除"
      confirm-icon="trash"
      tone="danger"
      @confirm="confirmRemoveBlock"
    >
      确定删除这条消息块吗?此操作不可撤销(可以点「恢复默认」重建默认预设的块,但你自己的改动会一起没)。
    </ConfirmDialog>

    <ConfirmDialog
      v-model:open="presetDeleteOpen"
      title="删除预设"
      confirm-text="删除"
      confirm-icon="trash"
      tone="danger"
      @confirm="confirmRemovePreset"
    >
      确定删除预设「{{ active.name }}」吗?此操作不可撤销,建议先「导出」备份。
    </ConfirmDialog>
  </Collapsible>
</template>

<style scoped>
/* —— 预设行 —— */
.bbi-preset-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bbi-preset-row :deep(.bbi-select) {
  flex: 1 1 auto;
  min-width: 0;
}
.bbi-preset-ops {
  position: relative;
  flex: 0 0 auto;
}
.bbi-preset-ops-panel {
  position: absolute;
  z-index: 20;
  right: 0;
  top: calc(100% + 6px);
  width: 224px;
  padding: 10px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  box-shadow: 0 8px 24px oklch(0 0 0 / 0.18);
}
.bbi-preset-ops-title {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--bbi-ink-muted);
}
.bbi-preset-ops-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.bbi-preset-ops-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink);
  font-family: var(--bbi-font-sans);
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color var(--bbi-dur) var(--bbi-ease),
    color var(--bbi-dur) var(--bbi-ease);
}
.bbi-preset-ops-item:hover {
  border-color: var(--bbi-accent);
  color: var(--bbi-accent);
}
/* 预设删除项同样改回低调:默认不染红,只在 hover 时转危险色(与块行的垃圾桶一致) */
.bbi-preset-ops-item.is-danger:hover {
  border-color: var(--bbi-danger);
  color: var(--bbi-danger);
  background: var(--bbi-danger-soft);
}

/* —— 操作行 —— */
.bbi-prompt-actions {
  display: flex;
  gap: 8px;
  margin: 12px 0 10px;
}

/* —— 块列表 —— */
.bbi-prompt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bbi-prompt-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 8px 12px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius);
  background: var(--bbi-surface-2);
  cursor: grab;
  /* transform 带过渡 = 其余行"让位"是滑过去的,不是瞬移 */
  transition:
    transform 0.16s var(--bbi-ease),
    border-color var(--bbi-dur) var(--bbi-ease),
    opacity var(--bbi-dur) var(--bbi-ease);
}
.bbi-prompt-item:hover {
  border-color: var(--bbi-accent);
}
/* 停用/拖拽:压暗与高亮都只改视觉,不改布局(避免拖拽时行高跳动) */
.bbi-prompt-item.is-off {
  opacity: 0.55;
}
/* 被拖走的那一行留在原地当"空位" */
.bbi-prompt-item.is-lifted {
  opacity: 0.25;
}
/* 落位那一帧:DOM 已换位、位移也已清零,两个变化必须同时无动画,
   否则会看到块从旧位置滑回新位置(双影) */
.bbi-prompt-item.is-settling {
  transition: none;
}
/* 拖拽中禁掉文字选择,免得拖出一片蓝色选区 */
.bbi-prompt-list.is-dragging {
  user-select: none;
  cursor: grabbing;
}
/* 跟随指针的浮层:克隆自被拖那一行,挂在内层宿主上,所以样式与主题变量照旧。
   ⚠ z-index 必须高过 .bbi-overlay(10000):浮层挂在 modalHost(它是 .bbi-root 的直接子级,
   与遮罩同级),而遮罩是 position:fixed + z-index:10000。给小数值(比如 60)会被整块画在
   面板窗口后面 —— 浮层明明建出来了,用户却完全看不见,表现为"块不跟手"。
   同门的 .bbi-modal-mask 用 10001 也是这个道理;浮层要在那之上,故取 10002。 */
.bbi-drag-ghost {
  z-index: 10002;
  /* 不透明度由 startGhost 内联定死(见那里的注释):状态类的权重比这里高 */
  border-color: var(--bbi-accent) !important;
  box-shadow: 0 10px 28px oklch(0 0 0 / 0.28);
  transition: none !important;
  cursor: grabbing;
}
/* .bbi-prompt-item.is-locked / .bbi-locked-hint 随预填充联动删除:所有块都可拖、可删、可停用 */
.bbi-prompt-role {
  flex: 0 0 auto;
  width: 10.5ch;
  font-family: var(--bbi-font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--bbi-ink);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.bbi-prompt-name {
  flex: 0 1 auto;
  max-width: 42%;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--bbi-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bbi-prompt-preview {
  flex: 1 1 120px;
  min-width: 0;
  font-family: var(--bbi-font-mono);
  font-size: 11px;
  color: var(--bbi-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bbi-prompt-len {
  flex: 0 0 auto;
  font-family: var(--bbi-font-mono);
  font-size: 11px;
  color: var(--bbi-ink-muted);
  font-variant-numeric: tabular-nums;
}
.bbi-block-btns {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* —— 小号开关/图标按钮:列表行里要能排下五个控件 —— */
.bbi-toggle {
  position: relative;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: var(--bbi-radius-pill);
  background: var(--bbi-line-strong);
  cursor: pointer;
  transition: background var(--bbi-dur) var(--bbi-ease);
}
.bbi-toggle.is-on {
  background: var(--bbi-accent);
}
/* 锁定块的开关是只读的:显示状态,不接受点击 */
.bbi-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.75;
}
.bbi-toggle:focus-visible {
  outline: 2px solid var(--bbi-accent);
  outline-offset: 2px;
}
.bbi-toggle-sm {
  width: 34px;
  height: 20px;
}
.bbi-toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--bbi-surface);
  box-shadow: 0 1px 3px oklch(0 0 0 / 0.25);
  transition: transform var(--bbi-dur) var(--bbi-ease);
}
.bbi-toggle-sm.is-on .bbi-toggle-knob {
  transform: translateX(14px);
}

/* —— 图标按钮(编辑/删除/预设操作/弹窗关闭):默认无框无底,只留一枚弱化图标 ——
   这一屏最多能排十几个按钮,常显描边会直接变成噪点(用户反馈:黑色/红色边缘太明显)。
   边框留 1px **透明**而不是 0:hover 时补上颜色才不会让尺寸跳 1px、整行跟着抖。
   hover 底色用 --bbi-surface(比行底 --bbi-surface-2 亮一档),否则底色和行底同色、看不出变化。 */
.bbi-icon-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: var(--bbi-radius-sm);
  background: transparent;
  color: var(--bbi-ink-muted);
  cursor: pointer;
  transition:
    color var(--bbi-dur) var(--bbi-ease),
    background var(--bbi-dur) var(--bbi-ease),
    border-color var(--bbi-dur) var(--bbi-ease);
}
.bbi-icon-mini:hover {
  border-color: var(--bbi-line);
  background: var(--bbi-surface);
  color: var(--bbi-ink);
}
/* 删除按钮同样默认弱化,只在 hover 时转危险色:
   破坏性操作靠 hover 提示足够,常红会把整列都染红(用户明确要求低调)。 */
.bbi-icon-mini.is-danger:hover {
  color: var(--bbi-danger);
  border-color: var(--bbi-danger);
  background: var(--bbi-danger-soft);
}
/* 键盘可达性:焦点态与 hover 同等明显 */
.bbi-icon-mini:focus-visible {
  outline: 2px solid var(--bbi-accent);
  outline-offset: 2px;
}
.bbi-modal-head .bbi-icon-mini {
  width: 32px;
  height: 32px;
}
.bbi-icon-xs {
  width: 26px;
  height: 26px;
  font-size: 12px;
}

/* —— 预设操作钮:照「渠道 → 提示词 → 画师串」那一行操作钮的样子 ——
   那边(.bbi-icon-btn)靠**填充底色**显形、不靠描边:36×36、surface-2 底、无边框,
   hover 底色转 line-strong、图标转 ink。模块里其余图标钮走的是"默认无框"的安静版;
   预设这颗是这一块唯一的入口,必须一眼看见,所以按参考单独给一套。 */
.bbi-icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink-soft);
  cursor: pointer;
  font-size: 15px;
  transition:
    color var(--bbi-dur) var(--bbi-ease),
    background var(--bbi-dur) var(--bbi-ease);
}
.bbi-icon-btn:hover {
  color: var(--bbi-ink);
  background: var(--bbi-line-strong);
}
.bbi-icon-btn:focus-visible {
  outline: 2px solid var(--bbi-accent);
  outline-offset: 2px;
}
.bbi-flip {
  transform: rotate(180deg);
}

/* —— 合并设置 —— */
.bbi-merge-box {
  margin-top: 16px;
  /* 与下方「可用变量」拉开:两块贴在一起时,折叠头看起来像是合并设置的一部分 */
  margin-bottom: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--bbi-line);
}

/* —— 变量清单 —— */
.bbi-var-group + .bbi-var-group {
  margin-top: 12px;
}
.bbi-var-group-title {
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--bbi-ink-muted);
}
.bbi-var-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bbi-var-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  font-size: 12px;
  line-height: 1.5;
}
.bbi-var-name {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink);
  font-family: var(--bbi-font-mono);
  font-size: 11px;
}
.bbi-var-label {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--bbi-ink);
}
.bbi-var-desc {
  flex: 1 1 100%;
  color: var(--bbi-ink-muted);
  font-size: 11.5px;
}

/* —— 导入弹窗 —— */
.bbi-import-warnings {
  margin: 0 0 10px;
  padding-left: 18px;
  color: var(--bbi-danger);
  font-size: 12px;
  line-height: 1.6;
}
.bbi-import-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow-y: auto;
}
.bbi-import-item {
  padding: 10px 12px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
}
.bbi-import-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--bbi-ink);
}
.bbi-import-meta {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 400;
  color: var(--bbi-ink-muted);
}
.bbi-import-choice {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--bbi-ink-muted);
}
.bbi-import-choice label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

/* —— 弹窗 —— */
.bbi-modal-wide {
  max-width: 680px;
}

/* 文件选择框永远不显示,靠按钮触发 */
.bbi-hidden-input {
  display: none;
}
</style>
