<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { PROMPT_SKIP_LABELS } from '@/autoTag/promptRender';
import { PROMPT_ROLE_LABELS } from '@/autoTag/promptPreset';
import type { PromptPreviewOutcome } from '@/autoTag/promptPreview';
import { copyText } from '@/st/clipboard';
import { ROUGH_TOKEN_HINT as TOKEN_HINT, roughTokenLabel as tokenLabel } from '@/tokens';
import { computed, ref, watch } from 'vue';

/**
 * 预览弹窗:把「照现在的设置真发出去会长什么样」摊开。
 *
 * - 上半 = 合并后的最终消息(**真正会发出去的东西**,全文展示,不限高到看不见);
 * - 下半 = 合并前的逐块明细(含被跳过的块与跳过原因),默认收起;
 * - 纯本地渲染,不消耗额度、不写请求历史(见 promptPreview.ts)。
 */
const props = defineProps<{
  open: boolean;
  loading: boolean;
  outcome: PromptPreviewOutcome | null;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const showDetail = ref(false);
// 每次打开都收起明细:上次展开的状态带到这次会让人以为在看重播
watch(
  () => props.open,
  value => {
    if (value) showDetail.value = false;
  },
);

const ok = computed(() => (props.outcome && props.outcome.ok ? props.outcome : null));
const fail = computed(() => (props.outcome && !props.outcome.ok ? props.outcome.error : ''));

function roleLabel(role: string): string {
  return PROMPT_ROLE_LABELS[role as keyof typeof PROMPT_ROLE_LABELS] ?? role.toUpperCase();
}

/** 变量写法放脚本里拼:模板插值里出现 {{ }} 会让 Vue 模板解析器提前收尾 */
function varTokens(names: string[]): string {
  return names.map(name => `{{${name}}}`).join(' ');
}

function copyAll(): void {
  if (!ok.value) return;
  const text = ok.value.assembly.messages
    .map(m => `===== ${roleLabel(m.role)} =====\n${m.content}`)
    .join('\n\n');
  void copyText(text, '已复制全部消息');
}
</script>

<template>
  <ModalMask :open="open" @close="emit('close')">
    <div
      v-if="open"
      class="bbi-modal bbi-modal-wide bbi-scrollbars"
      role="dialog"
      aria-modal="true"
      aria-label="提示词预览"
    >
      <header class="bbi-modal-head">
        <span class="bbi-modal-title">预览 · 最终发送效果</span>
        <button class="bbi-icon-mini" type="button" title="关闭" @click="emit('close')">
          <Icon name="close" />
        </button>
      </header>

      <p class="bbi-preview-note">
        变量按<strong>当前聊天 + 当前设置</strong>实时求值;这是纯本地渲染,不消耗额度、不写请求历史。
        真正生成时(记忆、世界书激活结果、单张重写的任务备注)可能略有不同。
      </p>

      <p v-if="loading" class="bbi-preview-loading">正在渲染…</p>

      <p v-else-if="fail" class="bbi-preview-error">{{ fail }}</p>

      <template v-else-if="ok">
        <div class="bbi-preview-meta">
          <span>预设:<strong>{{ ok.assembly.presetName }}</strong></span>
          <span>目标楼:第 {{ ok.floor }} 层(共 {{ ok.floorCount }} 层)</span>
          <span>出口:{{ ok.channelName ?? '跟随主 API' }}</span>
          <span>相邻同角色合并:{{ ok.assembly.mergeAdjacent ? '开' : '关' }}</span>
          <span>合并 System 和 User:{{ ok.assembly.mergeSystemUser ? '开' : '关' }}</span>
        </div>

        <!-- 不再有"因渠道开关而不发"的块:发不发只看块自己的开关,故这里没有任何特例说明 -->

        <ul v-if="ok.warnings.length" class="bbi-preview-warnings">
          <li v-for="(warning, i) in ok.warnings" :key="i">{{ warning }}</li>
        </ul>

        <div class="bbi-preview-msgs">
          <section v-for="(message, i) in ok.assembly.messages" :key="i" class="bbi-preview-msg">
            <div class="bbi-preview-msg-head">
              <span class="bbi-prompt-role">{{ roleLabel(message.role) }}</span>
              <span class="bbi-prompt-len" :title="TOKEN_HINT">{{ tokenLabel(message.content) }}</span>
            </div>
            <!-- 与「请求历史」同款:长正文要能拖滚动条 -->
            <pre class="bbi-hist-text bbi-scrollbars">{{ message.content }}</pre>
          </section>
        </div>

        <button class="bbi-btn bbi-btn-sm bbi-preview-detail-toggle" type="button" @click="showDetail = !showDetail">
          <Icon name="chevron" :class="{ 'is-open': showDetail }" />
          {{ showDetail ? '收起消息块明细' : '展开消息块明细(含被跳过的块)' }}
        </button>

        <ul v-if="showDetail" class="bbi-preview-blocks">
          <li
            v-for="block in ok.assembly.blocks"
            :key="block.id"
            class="bbi-preview-block"
            :class="{ 'is-skipped': block.skipped }"
          >
            <span class="bbi-prompt-role">{{ roleLabel(block.role) }}</span>
            <span class="bbi-preview-block-name">{{ block.name }}</span>
            <span class="bbi-preview-block-state">
              {{ block.skipped ? PROMPT_SKIP_LABELS[block.skipReason ?? 'empty'] : tokenLabel(block.text) }}
            </span>
            <span v-if="block.vars.length" class="bbi-preview-block-vars">
              {{ varTokens(block.vars) }}
            </span>
            <span v-if="block.unknownVars.length" class="bbi-preview-block-unknown">
              未识别:{{ varTokens(block.unknownVars) }}
            </span>
          </li>
        </ul>

        <footer class="bbi-modal-foot">
          <button class="bbi-btn" type="button" @click="copyAll"><Icon name="copy" /> 复制全部</button>
        </footer>
      </template>
    </div>
  </ModalMask>
</template>

<style scoped>
.bbi-modal-wide {
  max-width: 760px;
}
.bbi-icon-mini {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink-soft);
  cursor: pointer;
}
.bbi-icon-mini:hover {
  color: var(--bbi-accent);
  border-color: var(--bbi-accent);
}

.bbi-preview-note {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--bbi-ink-muted);
}
.bbi-preview-loading,
.bbi-preview-error {
  margin: 12px 0;
  font-size: 13px;
}
.bbi-preview-error {
  color: var(--bbi-danger);
  overflow-wrap: anywhere;
}

/* 元信息一行行排,窄屏自然换行 */
.bbi-preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--bbi-ink-muted);
}

/* 非阻断警告:红字但不挡路 */
.bbi-preview-warnings {
  margin: 0 0 12px;
  padding: 10px 12px 10px 28px;
  list-style: disc;
  border: 1px solid var(--bbi-danger);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-danger-soft);
  color: var(--bbi-danger);
  font-size: 12.5px;
  line-height: 1.6;
}

.bbi-preview-msgs {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* 消息列表现已没有任何"会被丢弃/被跳过"的态:跳过的块只在明细里标注原因。
   (.bbi-preview-dropped / .bbi-preview-detail-hint 随预填充联动一起删除) */
.bbi-preview-msg-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.bbi-prompt-role {
  flex: 0 0 auto;
  width: 10.5ch;
  font-family: var(--bbi-font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--bbi-ink);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.bbi-prompt-len {
  font-family: var(--bbi-font-mono);
  font-size: 11px;
  color: var(--bbi-ink-muted);
  font-variant-numeric: tabular-nums;
}
.bbi-hist-text {
  margin: 0;
  padding: 12px 14px;
  max-height: 40vh;
  /* 与「请求历史」同款:常驻滑槽(见那边的说明) */
  overflow-y: scroll;
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  color: var(--bbi-ink);
  font-family: var(--bbi-font-mono);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
  user-select: text;
}

.bbi-preview-detail-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
}
.bbi-preview-detail-toggle .is-open {
  transform: rotate(180deg);
}

.bbi-preview-blocks {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bbi-preview-block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 8px 12px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface-2);
  font-size: 12px;
}
/* 被跳过的块压暗:一眼看出"这条其实没发出去" */
.bbi-preview-block.is-skipped {
  opacity: 0.6;
}
.bbi-preview-block-name {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--bbi-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bbi-preview-block-state,
.bbi-preview-block-vars,
.bbi-preview-block-unknown {
  font-family: var(--bbi-font-mono);
  font-size: 11px;
  color: var(--bbi-ink-muted);
}
.bbi-preview-block-unknown {
  color: var(--bbi-danger);
}
</style>
