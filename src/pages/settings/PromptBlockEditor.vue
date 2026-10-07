<script setup lang="ts">
import BbiSelect from '@/components/BbiSelect.vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import { restoreContractContent } from '@/autoTag/promptPreset';
import type { AutoTagPromptBlock, PromptRole } from '@/state/settings';
import { ref, watch } from 'vue';

/**
 * 消息块编辑弹窗。外观沿用「请求历史」里点开消息块的那个宽弹窗(bi-modal-wide),
 * 可改的就三项:名称、角色、正文 —— 与智绘姬的条目编辑一致。
 *
 * 「恢复内置默认」只出现在固定输出协议块上:它的正文与上游默认强相关
 * (规则会随版本更新),别的块没有"内置默认"可言(见 settings 的 builtin 字段说明)。
 * 角色/内容/名称一律可改 —— 预填充块自从降级为普通块后,这里也不再有任何锁定。
 */
const props = defineProps<{ open: boolean; block: AutoTagPromptBlock | null }>();
const emit = defineEmits<{
  (e: 'save', value: { name: string; role: PromptRole; content: string }): void;
  (e: 'close'): void;
}>();

const ROLE_OPTIONS = [
  { value: 'system', label: 'System（系统）' },
  { value: 'user', label: 'User（用户）' },
  { value: 'assistant', label: 'Assistant（助手）' },
];

const name = ref('');
const role = ref<PromptRole>('system');
const content = ref('');

// 每次打开都从传入的块重建草稿:中途取消不应留下半截改动
watch(
  () => [props.open, props.block] as const,
  () => {
    if (!props.open || !props.block) return;
    name.value = props.block.name;
    role.value = props.block.role;
    content.value = props.block.content;
  },
  { immediate: true },
);

function save(): void {
  if (!props.block) return;
  emit('save', {
    name: name.value.trim() || props.block.name,
    role: role.value,
    content: content.value,
  });
}

function resetContract(): void {
  if (!props.block) return;
  const draft: AutoTagPromptBlock = { ...props.block };
  restoreContractContent(draft);
  content.value = draft.content;
}
</script>

<template>
  <ModalMask :open="open" @close="emit('close')">
    <div
      v-if="open && block"
      class="bbi-modal bbi-modal-wide bbi-scrollbars"
      role="dialog"
      aria-modal="true"
      aria-label="编辑消息块"
    >
      <header class="bbi-modal-head">
        <span class="bbi-modal-title">编辑消息块</span>
        <button class="bbi-icon-mini" type="button" title="关闭" @click="emit('close')">
          <Icon name="close" />
        </button>
      </header>

      <div class="bbi-block-edit-row">
        <input
          v-model="name"
          class="bbi-input"
          type="text"
          placeholder="消息块名称"
          spellcheck="false"
        />
        <BbiSelect v-model="role" :options="ROLE_OPTIONS" aria-label="角色" />
      </div>

      <!-- fill:高度交给 flex(够高就撑满、不够就缩到可用高度并内部滚动)。
           rows=30 只是"起始基准高",不是上限 —— 高窗口下能显示全部内容,矮窗口下自动内部滚动。
           早先写死 rows=14/max-rows=30 时,矮窗口会把它压到 396px 而 overflow 仍是 hidden,
           底下 182px 内容既看不见也滚不到。 -->
      <BbiTextarea v-model="content" class="bbi-scrollbars" fill :rows="30" mono />

      <footer class="bbi-modal-foot">
        <button
          v-if="block.builtin === 'contract'"
          class="bbi-btn bbi-btn-danger"
          type="button"
          title="把这段协议换成当前版本的默认文本(你自己的改动会丢失)"
          @click="resetContract"
        >
          <Icon name="refresh" /> 恢复内置默认
        </button>
        <span class="bbi-modal-foot-spacer"></span>
        <button class="bbi-btn" type="button" @click="emit('close')">取消</button>
        <button class="bbi-btn bbi-btn-primary" type="button" @click="save">保存</button>
      </footer>
    </div>
  </ModalMask>
</template>

<style scoped>
/* —— 宽弹窗与图标按钮:scoped 过不了组件边界,各组件各抄一份(仓库既有做法) —— */
.bbi-modal-wide {
  max-width: 680px;
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
  transition:
    color var(--bbi-dur) var(--bbi-ease),
    border-color var(--bbi-dur) var(--bbi-ease);
}
.bbi-icon-mini:hover {
  color: var(--bbi-accent);
  border-color: var(--bbi-accent);
}

/* 名称与角色同一行:名称占满剩余宽度,角色固定一档 */
.bbi-block-edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.bbi-block-edit-row .bbi-input {
  flex: 1 1 auto;
  min-width: 0;
}
.bbi-block-edit-row :deep(.bbi-select) {
  flex: 0 0 auto;
  min-width: 148px;
}
/* .bbi-role-locked / .bbi-block-locked-note 随预填充联动一起删除:角色不再有任何锁定 */
</style>
