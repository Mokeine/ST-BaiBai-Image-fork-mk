<script setup lang="ts">
import BbiTextarea from '@/components/BbiTextarea.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import {
  chatOutfitLib,
  copyOutfitToChat,
  globalOutfitLib,
  outfitChips,
  outfitView,
  promoteOutfitToGlobal,
  removeOutfit,
  renameOutfit,
  setOutfit,
  type OutfitLayer,
} from '@/state/outfitTags';
import { computed, reactive, ref } from 'vue';

/**
 * 服装管理 —— 两层「服装名 → 外观 tag / 状态」字典,口径与角色管理一致:
 * - 全局服装库:跨聊天共用的外观模板(不存状态 —— 破损/湿润是剧情状态,不属于跨故事的东西);
 * - 本聊天服装:仅当前聊天,同名时覆盖全局。
 *
 * 名字不能随便起:它必须与剧情变量里 `主角:` → `装备:` 下的条目名**逐字相同**,
 * 那是整套机制唯一的对档键 —— AI 认出"这件就是库里那件"靠的就是字符串相等。
 *
 * 主线是 AI 建档(main 用法),本页的手工维护只是兜底。
 */

interface Draft {
  layer: OutfitLayer;
  /** 编辑前原名(null = 新增)。改名时用它做重命名而不是留下两条。 */
  original: string | null;
  name: string;
  tag: string;
  state: string;
}

const draft = ref<Draft | null>(null);
const pendingDelete = ref<{ name: string; layer: OutfitLayer } | null>(null);
const deleteOpen = ref(false);
const keyword = ref('');
const fold = reactive({ chat: true, global: true });

const view = computed(() => outfitView());
const filter = (entries: ReturnType<typeof outfitView>) => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return entries;
  return entries.filter(e => e.name.toLowerCase().includes(kw) || e.tag.toLowerCase().includes(kw));
};
const chatEntries = computed(() => filter(view.value.filter(e => e.layer === 'chat')));
const globalEntries = computed(() => filter(view.value.filter(e => e.layer === 'global')));
/** 合并视图里本聊天优先,所以全局区只显示"没有被本聊天覆盖"的那些。 */
const overriddenCount = computed(() => view.value.filter(e => e.overridesGlobal).length);
const missing = computed(() => view.value.filter(e => !e.tag).length);

/** 卡片上的外观 chips:按逗号切、最多 4 段、累计 60 字符封顶(见 outfitChips)。 */
function chips(tag: string) {
  return outfitChips(tag);
}

function openNew(layer: OutfitLayer): void {
  draft.value = { layer, original: null, name: '', tag: '', state: '' };
}

function openEdit(name: string, layer: OutfitLayer): void {
  const entry = view.value.find(e => e.name === name);
  if (!entry) return;
  draft.value = { layer, original: name, name: entry.name, tag: entry.tag, state: entry.state };
}

function saveDraft(): void {
  const current = draft.value;
  if (!current) return;
  const name = current.name.trim();
  if (!name) {
    toastr.warning('服装名不能为空。', '柏宝绘');
    return;
  }
  // 先改名再写内容:改名会合并同名条目,合并后按弹窗里的值落定
  if (current.original && current.original !== name) {
    renameOutfit(current.original, name, current.layer);
  }
  setOutfit(name, { tag: current.tag, state: current.state }, current.layer);
  toastr.success(`已保存「${name}」`, '柏宝绘');
  draft.value = null;
}

function askDelete(): void {
  const current = draft.value;
  if (!current?.original) return;
  pendingDelete.value = { name: current.original, layer: current.layer };
  deleteOpen.value = true;
}

function doDelete(): void {
  const target = pendingDelete.value;
  if (target) removeOutfit(target.name, target.layer);
  deleteOpen.value = false;
  draft.value = null;
}

function moveToChat(): void {
  const current = draft.value;
  if (!current) return;
  copyOutfitToChat(current.original ?? current.name);
  toastr.success(`已把「${current.name}」复制到本聊天`, '柏宝绘');
  draft.value = { ...current, layer: 'chat', original: current.name };
}

function moveToGlobal(): void {
  const current = draft.value;
  if (!current) return;
  promoteOutfitToGlobal(current.original ?? current.name);
  toastr.success(`已把「${current.name}」提升为全局(状态不带走)`, '柏宝绘');
  draft.value = { ...current, layer: 'global', original: current.name, state: '' };
}
</script>

<template>
  <section class="bbi-page">
    <div class="bbi-page-head">
      <h2 class="bbi-title bbi-title-sub">服装管理</h2>
      <input v-model="keyword" class="bbi-input out-search" placeholder="搜索名字或 tag" />
    </div>
    <p class="bbi-page-intro">
      服装字典:名字 → 外观 tag(+ 当前状态)。名字要与剧情变量里 <code>主角: → 装备:</code>
      的条目名逐字相同,AI 才能认出"就是库里的这件"并照抄它的外观。穿脱不会改动这里
      (换下的装备只是从变量里移走),所以每件只需建一次档。
    </p>
    <hr class="bbi-rule" />

    <!-- ===== 本聊天服装 ===== -->
    <div class="bbi-fold-head">
      <button class="bbi-fold-toggle" type="button" @click="fold.chat = !fold.chat">
        <Icon name="chevron" class="bbi-fold-caret" :class="{ 'is-collapsed': !fold.chat }" />
        <span class="bbi-field-label">本聊天服装</span>
        <span class="bbi-count">{{ chatEntries.length }}</span>
      </button>
      <button class="bbi-add-mini" type="button" title="添加本聊天服装" @click="openNew('chat')">
        <Icon name="plus" />
      </button>
    </div>
    <div class="bbi-fold-wrap" :class="{ 'is-collapsed': !fold.chat }">
      <div class="bbi-fold-inner">
        <p class="bbi-field-hint">
          仅当前聊天生效:状态(破损、湿润…)只存在这一层。同名条目会覆盖全局库。
        </p>
        <ul v-if="chatEntries.length" class="out-grid">
          <li v-for="entry in chatEntries" :key="entry.name" class="out-card">
            <button class="out-card-btn" type="button" :title="entry.tag" @click="openEdit(entry.name, 'chat')">
              <span class="out-card-head">
                <span class="out-name">{{ entry.name }}</span>
                <span class="out-pills">
                  <span class="out-pill is-ai" title="由 AI 随剧情自动建档与更新(手动编辑不影响此标记)">
                    AI维护
                  </span>
                  <span v-if="entry.overridesGlobal" class="out-pill is-override" title="与全局库同名,本聊天以本条为准">
                    覆盖全局
                  </span>
                </span>
              </span>
              <span v-if="entry.tag" class="out-chips">
                <span v-for="chip in chips(entry.tag).chips" :key="chip" class="out-chip" :title="chip">
                  {{ chip }}
                </span>
                <span v-if="chips(entry.tag).hidden" class="out-chip is-more" title="还有更多未显示,点开看完整">
                  +{{ chips(entry.tag).hidden }}
                </span>
              </span>
              <span v-else class="out-raw out-tag-empty">待补外观 tag</span>
              <span v-if="entry.state" class="out-chip is-state" title="当前状态">状态 · {{ entry.state }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="out-empty">本聊天还没有服装。AI 建档后会自动出现在这里,也可点右上角「+」手动补。</p>
      </div>
    </div>

    <!-- ===== 全局服装库 ===== -->
    <div class="bbi-fold-head">
      <button class="bbi-fold-toggle" type="button" @click="fold.global = !fold.global">
        <Icon name="chevron" class="bbi-fold-caret" :class="{ 'is-collapsed': !fold.global }" />
        <span class="bbi-field-label">全局服装库</span>
        <span class="bbi-count">{{ globalEntries.length }}</span>
      </button>
      <button class="bbi-add-mini" type="button" title="添加全局服装" @click="openNew('global')">
        <Icon name="plus" />
      </button>
    </div>
    <div class="bbi-fold-wrap" :class="{ 'is-collapsed': !fold.global }">
      <div class="bbi-fold-inner">
        <p class="bbi-field-hint">
          跨所有聊天共用的外观模板:<strong>不存状态</strong> —— 破损、湿润是剧情状态,只属于某一个故事。
        </p>
        <ul v-if="globalEntries.length" class="out-grid">
          <li v-for="entry in globalEntries" :key="entry.name" class="out-card">
            <button class="out-card-btn" type="button" :title="entry.tag" @click="openEdit(entry.name, 'global')">
              <span class="out-card-head">
                <span class="out-name">{{ entry.name }}</span>
                <span class="out-pills">
                  <span class="out-pill is-global" title="跨聊天共用的外观模板(不存状态)">全局</span>                </span>
              </span>
              <span v-if="entry.tag" class="out-chips">
                <span v-for="chip in chips(entry.tag).chips" :key="chip" class="out-chip" :title="chip">
                  {{ chip }}
                </span>
                <span v-if="chips(entry.tag).hidden" class="out-chip is-more" title="还有更多未显示,点开看完整">
                  +{{ chips(entry.tag).hidden }}
                </span>
              </span>
              <span v-else class="out-raw out-tag-empty">待补外观 tag</span>
            </button>
          </li>
        </ul>
        <p v-else class="out-empty">全局库还是空的。想让某件衣服在所有聊天里都长一个样,把本聊天条目「提升为全局」。</p>
        <p v-if="overriddenCount" class="bbi-field-hint">
          有 {{ overriddenCount }} 个本聊天条目与全局同名,当前以本聊天为准(已在上面标出)。
        </p>
      </div>
    </div>

    <p v-if="keyword && !chatEntries.length && !globalEntries.length" class="bbi-field-hint">
      没有匹配「{{ keyword }}」的服装。
    </p>
    <p v-else-if="missing" class="bbi-field-hint">共 {{ view.length }} 件,其中 {{ missing }} 件还缺外观 tag。</p>

    <!-- ===== 条目弹窗 ===== -->
    <ModalMask :open="!!draft" @close="draft = null">
      <div v-if="draft" class="bbi-modal out-modal" role="dialog" aria-modal="true" aria-label="服装条目">
        <div class="bbi-modal-head">
          <span class="bbi-modal-title">
            {{ draft.original ? '编辑服装' : '新增服装' }} ·
            {{ draft.layer === 'chat' ? '本聊天' : '全局库' }}
          </span>
          <button class="bbi-icon-mini" type="button" title="关闭" @click="draft = null">
            <Icon name="close" />
          </button>
        </div>
        <div class="bbi-modal-body">
          <div class="bbi-field">
            <div class="bbi-field-label">服装名</div>
            <input
              v-model="draft.name"
              class="bbi-input"
              placeholder="与变量里 装备: 下的条目名逐字相同,例如「永夜星河晚礼服」"
            />
            <p class="bbi-field-hint">
              含 <code>·</code>、空格、书名号也要照抄 —— 差一个字,AI 就认不出是同一件。
            </p>
          </div>
          <div class="bbi-field">
            <div class="bbi-field-label">外观 tag</div>
            <BbiTextarea v-model="draft.tag" class="bbi-scrollbars" fill :rows="8" mono />
            <p class="bbi-field-hint">
              只写这件服装本身:款式/剪裁/颜色/材质/部件。不写质量词、负面词与游戏数值(品质/防御/效果)。
            </p>
          </div>
          <div class="bbi-field">
            <div class="bbi-field-label">状态</div>
            <input
              v-model="draft.state"
              class="bbi-input"
              :disabled="draft.layer === 'global'"
              placeholder="当前穿着状态:破损、湿润、被扯歪…正常时留空"
            />
            <p v-if="draft.layer === 'global'" class="bbi-field-hint">
              状态属于剧情,只存在本聊天层;想给它一个状态,先「复制到本聊天」。
            </p>
            <p v-else class="bbi-field-hint">
              状态会拼在外观后面一起发给 AI;剧情恢复正常(烘干、修补、换下)时记得清空。
            </p>
          </div>
        </div>
        <div class="bbi-modal-foot">
          <button v-if="draft.original" class="bbi-btn out-danger" type="button" @click="askDelete">
            <Icon name="trash" /><span>删除</span>
          </button>
          <span class="out-foot-gap"></span>
          <button
            v-if="draft.layer === 'global'"
            class="bbi-btn bbi-btn-sm"
            type="button"
            title="把全局外观复制成一条本聊天条目,之后可以单独给它状态"
            @click="moveToChat"
          >
            复制到本聊天
          </button>
          <button
            v-else
            class="bbi-btn bbi-btn-sm"
            type="button"
            title="提升为全局后,本聊天这条会被删掉(状态不带走)"
            @click="moveToGlobal"
          >
            提升为全局
          </button>
          <button class="bbi-btn" type="button" @click="draft = null">取消</button>
          <button class="bbi-btn bbi-btn-primary" type="button" @click="saveDraft">完成</button>
        </div>
      </div>
    </ModalMask>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="删除服装"
      confirm-text="删除"
      confirm-icon="trash"
      tone="danger"
      top-layer
      @confirm="doDelete"
    >
      确定从{{ pendingDelete?.layer === 'global' ? '全局库' : '本聊天' }}删除「{{ pendingDelete?.name }}」?
      删掉后 AI 再遇到这件就只能凭记忆写,容易前后不一致。
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.out-search {
  flex: 0 1 240px;
}

/* 折叠区头部:与角色管理同款(整行标题可点 + 右侧「+」) */
.bbi-fold-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.bbi-fold-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  cursor: pointer;
}

.bbi-fold-toggle:hover {
  background: var(--bbi-hover);
}

.bbi-fold-caret {
  transition: transform 0.15s ease;
}

.bbi-fold-caret.is-collapsed {
  transform: rotate(-90deg);
}

.bbi-count {
  font-size: 12px;
  color: var(--bbi-text-dim);
}

.bbi-add-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--bbi-border);
  border-radius: 6px;
  background: var(--bbi-surface-2);
  color: var(--bbi-text-dim);
  cursor: pointer;
}

.bbi-add-mini:hover {
  background: var(--bbi-hover);
  color: var(--bbi-text);
}

.bbi-fold-wrap {
  overflow: hidden;
}

.bbi-fold-wrap.is-collapsed {
  display: none;
}

.bbi-fold-inner {
  padding: 4px 0 10px;
}

.out-grid {
  display: grid;
  /* 尺寸照抄角色管理的角色卡网格 */
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

/* 卡片本身就是按钮:卡面上不放任何按钮(与角色管理一致) */
.out-card-btn {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  border: 1px solid var(--bbi-line, var(--bbi-border));
  border-radius: var(--bbi-radius, 8px);
  background: var(--bbi-surface);
  color: var(--bbi-ink, inherit);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.out-card-btn:hover {
  border-color: var(--bbi-accent);
  box-shadow: 0 8px 20px -12px var(--bbi-overlay, rgb(0 0 0 / 45%));
  transform: translateY(-1px);
}

/* 名字在左、pills 在右上角(与角色管理同款布局) */
.out-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.out-pills {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 徽标药丸:样式逐条照抄角色管理(全局=实心强调;AI=强调浅底;覆盖=警示色) */
.out-pill {
  padding: 2px 9px;
  border: 1px solid var(--bbi-line);
  border-radius: var(--bbi-radius-pill);
  color: var(--bbi-ink-muted);
  background: var(--bbi-surface-2);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.out-pill.is-global {
  color: var(--bbi-accent-ink);
  background: var(--bbi-accent);
  border-color: transparent;
}

.out-pill.is-ai {
  color: var(--bbi-accent);
  background: var(--bbi-accent-soft);
  border-color: transparent;
}

.out-pill.is-override {
  color: var(--bbi-warning);
  background: var(--bbi-warning-soft);
  border-color: transparent;
}

.out-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
  min-width: 0;
}

/* chips:两行封顶,超出裁切(照抄角色管理) */
.out-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 52px;
  overflow: hidden;
}

.out-chip {
  padding: 3px 9px;
  border: 1px solid var(--bbi-line, var(--bbi-border));
  border-radius: 999px;
  background: var(--bbi-surface-2);
  color: var(--bbi-ink-soft, var(--bbi-text-dim));
  font-family: var(--bbi-font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.out-chip.is-more {
  font-weight: 600;
}

/* 状态不属于外观 chips:单独一条,永不被裁掉 */
.out-chip.is-state {
  align-self: flex-start;
  border-color: var(--bbi-accent, var(--bbi-border));
  white-space: normal;
}

/* 没有外观时回退:mono 小字两行截断(同角色管理的整串模式) */
.out-raw {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-family: var(--bbi-font-mono);
  font-size: 12px;
  color: var(--bbi-ink-muted, var(--bbi-text-dim));
  word-break: break-word;
}

.out-empty {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--bbi-text-dim);
}

.out-modal {
  width: min(720px, 92vw);
}

.bbi-modal-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}

.out-foot-gap {
  flex: 1 1 auto;
}

.out-danger {
  color: var(--bbi-danger, #e06c75);
}
</style>
