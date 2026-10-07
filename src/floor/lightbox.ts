import { h, render } from 'vue';

import Lightbox from '@/floor/Lightbox.vue';

/**
 * 命令式打开图片灯箱(供楼层卡片与图库调用)。
 *
 * 挂载位置与 components/confirm.ts 同款:插件 host 的 shadow root——那里有 dist/index.css
 * 与 --bbi-* 主题变量,挂 document.body 会裸奔无样式。
 *
 * 特意**不**挂进卡片自己的 shadow root:灯箱是 fixed 全屏层,而卡片活在 .mes_text 内部,
 * 那里的层叠上下文与 overflow 会把它裁掉。
 *
 * 键盘(2026-10 起):
 * - **A / D** 上一张 / 下一张(同一分组内,到头即停,不循环);
 * - **S** 显示/隐藏信息框(隐藏时图片放大到接近满屏);
 * - 方向键**只吞掉不响应** —— 酒馆本体把 → 绑定成"生成备用消息",不拦会在看图时
 *   平白多生成一条消息。
 *
 * 拦截靠**捕获阶段**监听 window:酒馆的快捷键挂在冒泡阶段,捕获先于冒泡,
 * 于是 `stopPropagation()` 能让它彻底收不到;灯箱关闭时立刻摘监听,不吞全局键。
 */

// 与 index.ts 的 HOST_ID 一致
const HOST_ID = 'bbi-app-host';

export interface LightboxItem {
  src: string;
  prompt?: string;
  filename?: string;
  /** 调用方自己的定位键(如归一化路径),按需取 prompt 时原样带回。 */
  key?: string;
}

export interface LightboxOptions {
  src: string;
  prompt?: string;
  filename?: string;
  /** 提供了才显示删除按钮;点删除先关灯箱再回调。 */
  onDelete?: () => void;
  /** 同组图片(按显示顺序)。给了它才能 A/D 翻页;缺省=单张。 */
  list?: LightboxItem[];
  /** 打开时停在 list 的哪一张。 */
  index?: number;
  /**
   * 按需取 prompt:当前这张还没有 prompt 而又要显示信息框时会调用它
   * (按 S 显示、或信息框开着时翻页)。返回空串表示这张确实没有提示词。
   */
  onRequestPrompt?: (item: LightboxItem, index: number) => Promise<string>;
}

/** 同一时刻只允许一个灯箱,重复调用先关旧的。 */
let closeCurrent: (() => void) | null = null;

const STYLE_ID = 'bbi-lightbox-keys-style';
/** 信息框藏起来时把图放大:只覆盖尺寸,不动组件自身的样式。 */
const KEY_STYLE = `
.bbi-lb-noinfo .bbi-lightbox__prompt { display: none; }
.bbi-lb-noinfo .bbi-lightbox__img { max-height: calc(100vh - 56px); }
`;

function ensureKeyStyle(root: ShadowRoot): void {
  if (root.getElementById?.(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = KEY_STYLE;
  root.appendChild(style);
}

export function openLightbox(options: LightboxOptions): void {
  const root = document.getElementById(HOST_ID)?.shadowRoot;
  if (!root) return;
  closeCurrent?.();
  ensureKeyStyle(root);

  const container = document.createElement('div');
  root.appendChild(container);

  const list: LightboxItem[] = options.list?.length
    ? options.list
    : [{ src: options.src, prompt: options.prompt, filename: options.filename }];
  let index = Math.min(Math.max(0, options.index ?? list.findIndex(item => item.src === options.src)), list.length - 1);
  if (index < 0) index = 0;
  /** 默认**不显示**信息框:先看图,S 才拉起提示词。 */
  let infoHidden = true;
  /** 正在取 prompt:防连按 S 重复请求。 */
  let fetching = false;

  const close = () => {
    if (closeCurrent !== close) return; // 已被后来者替换,不重复清理
    closeCurrent = null;
    window.removeEventListener('keydown', onKeydown, true);
    render(null, container);
    container.remove();
  };
  closeCurrent = close;

  const paint = (): void => {
    const item = list[index];
    container.classList.toggle('bbi-lb-noinfo', infoHidden);
    render(
      h(Lightbox, {
        // key 让换页时组件重建:图片与缩放/平移状态一起归位,不会带着上一张的位移
        key: index,
        src: item.src,
        prompt: item.prompt,
        filename: item.filename,
        deletable: !!options.onDelete,
        // 信息框由 prop 显式控制(S 键),不靠 CSS 类隐藏:按两次 S 一定能收起来
        showInfo: !infoHidden,
        onClose: close,
        onDelete: () => {
          close();
          options.onDelete?.();
        },
      }),
      container,
    );
  };

  /**
   * 需要显示信息框但当前这张还没 prompt 时,按需取一次。
   * 取到后写回该条目并重绘(下次翻回来不用再请求)。
   */
  const ensurePrompt = async (): Promise<void> => {
    const item = list[index];
    if (infoHidden || fetching || item.prompt || !options.onRequestPrompt) return;
    fetching = true;
    try {
      const text = await options.onRequestPrompt(item, index);
      // 期间可能已翻页/已关闭:只在仍是同一张、且仍要显示时写回
      if (list[index] === item) {
        item.prompt = text;
        if (!infoHidden) paint();
      }
    } finally {
      fetching = false;
    }
  };

  /**
   * 捕获阶段拦截。
   * - A/D:翻页;S:切信息框 —— 这三个 preventDefault + stopPropagation,酒馆收不到;
   * - 方向键:只吞不响应(酒馆的 → = 生成备用消息,看图时不该触发);
   * - 其余键(含 Esc,由组件自己关)**原样放行**。
   */
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (key !== 'a' && key !== 'd' && key !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 's') {
      infoHidden = !infoHidden;
      // 重绘(而不是只切 CSS 类):信息框的存在与否由组件的 prop 决定,
      // 状态永远和 infoHidden 一致 —— 再按一次必然收起来。
      paint();
      // 显示(而不是隐藏)时才可能要去取提示词
      if (!infoHidden) void ensurePrompt();
      return;
    }
    const next = key === 'd' ? index + 1 : index - 1;
    if (next < 0 || next >= list.length) return; // 到头即停,不循环
    index = next;
    paint();
    // 信息框开着时翻页:新的一张若没 prompt,顺手取回来
    void ensurePrompt();
  };

  paint();
  window.addEventListener('keydown', onKeydown, true);
}
