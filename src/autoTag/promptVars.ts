/**
 * 提示词变量表 —— **唯一来源**。
 *
 * 三处共用这一张表:块模板的渲染(按名取 values)、设置页「可用变量」清单
 * (按名 + 说明展示)、以及跳过判定(kind)。加变量只改这里。
 *
 * kind 决定该变量是否参与「整块跳过」:
 * - content:内容来源(角色卡/记忆/目标正文…)。块引用了 content 变量却全部取不到值时
 *   整块不发 —— 与旧版「抓不到角色卡就不发那条消息」同口径。
 * - fragment:片段宏({{nl}})。它只是往模板里塞一段可选文字,置空不代表这块没内容,
 *   所以不参与跳过判定 —— 否则关闭「生成自然语言」会把整份 ComfyUI 规范一起吞掉。
 *
 * 变量名硬编码在这里,用户不能新增;模板里写了表外的名字一律原样保留(拼错可见)。
 */
export type PromptVarKind = 'content' | 'fragment';

export interface PromptVarMeta {
  name: string;
  /** 设置页清单里显示的中文名。 */
  label: string;
  /** 一句话说明取值与变化依据。 */
  desc: string;
  kind: PromptVarKind;
  /** 清单分组标题。 */
  group: string;
}

export const PROMPT_VARIABLES: readonly PromptVarMeta[] = [
  {
    name: 'char_card',
    label: '角色卡设定',
    desc: '当前角色卡的描述/性格/情景。取不到角色卡或三个字段都为空时,引用它的块整块不发。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'persona',
    label: '玩家人设',
    desc: '用户人设(persona)。未设置时引用它的块整块不发。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'world_info',
    label: '世界书设定',
    desc: '按当前聊天激活的世界书条目文本。没有激活条目时引用它的块整块不发。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'book_memory',
    label: '柏宝书记忆',
    desc: '柏宝书提供的角色状态与剧情记忆。取不到时渲染为占位说明(与旧版一致,块照常发送)。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'char_library',
    label: '角色外貌库',
    desc: '当前聊天已建档角色的固定外貌。库为空时渲染为「当前为空」说明(与旧版一致,块照常发送)。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'outfit_library',
    label: '服装库',
    desc: '当前聊天已记录的服装(名字 → tag)。库为空时渲染为「当前为空」说明(与角色外貌库同口径,块照常发送)。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'chat_context',
    label: '上下文',
    desc: '按「发送历史层数」携带的最近楼层,已清洗,带「--- 上下文｜角色 ---」表头。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'target_text',
    label: '目标正文',
    desc: '本轮要配图的那一楼正文,已清洗并标好段落编号(P1、P2…)。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'target_role',
    label: '目标楼角色标签',
    desc: '目标正文的说话方标签,如 assistant(小雪)。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'task_note',
    label: '任务备注',
    desc: '仅「单张重写提示词」时才有值(说明只重写第 N 张)。平时为空,引用它的块整块不发。',
    kind: 'content',
    group: '内容',
  },
  {
    name: 'output_shape',
    label: '示例 JSON',    desc: '协议要求的输出结构示例。随图片数量、自然语言开关、动态负面词、NAI 角色提示词开关变化。',
    kind: 'content',
    group: '协议',
  },
  {
    name: 'image_count_rule',
    label: '图片数量规则',
    desc: '本轮 images 数量的区间要求,随设置里的最少/最多张数变化。',
    kind: 'content',
    group: '协议',
  },
  {
    name: 'content_rule',
    label: '内容书写规则',
    desc: 'tag / nl 的书写要求。按自然语言开关与 NAI 角色提示词支持情况切换成不同变体。',
    kind: 'content',
    group: '协议',
  },
  {
    name: 'negative_rule',
    label: '负面词规则',
    desc: '本画面专用负面词的要求。仅当前工作流支持负面词输入时有内容,否则为空。',
    kind: 'content',
    group: '协议',
  },
  {
    name: 'character_rule',
    label: '建档与变化规则',
    desc: '角色建档、永久外貌变化、多人绑定的全部规则。**角色库自动建档靠的就是它**,删掉即不再自动建档。',
    kind: 'content',
    group: '协议',
  },
  {
    name: 'nl',
    label: '自然语言规范',
    desc: '开启「生成自然语言」时展开为自然语言规范全文,关闭时置空;置空后留下的连续空行会自动折叠。',
    kind: 'fragment',
    group: '片段',
  },
];

/** 模板渲染时按名取值的变量值表;键与 PROMPT_VARIABLES 的 name 一一对应。 */
export interface PromptVariableValues {
  char_card: string;
  persona: string;
  world_info: string;
  book_memory: string;
  char_library: string;
  outfit_library: string;
  chat_context: string;
  target_text: string;
  target_role: string;
  task_note: string;
  output_shape: string;
  image_count_rule: string;
  content_rule: string;
  negative_rule: string;
  character_rule: string;
  nl: string;
}

export type PromptVariableName = keyof PromptVariableValues;

const VAR_NAMES = new Set<string>(PROMPT_VARIABLES.map(v => v.name));
const CONTENT_VAR_NAMES = new Set<string>(
  PROMPT_VARIABLES.filter(v => v.kind === 'content').map(v => v.name),
);

export function isPromptVariableName(name: string): name is PromptVariableName {
  return VAR_NAMES.has(name);
}

/** 是否是参与「整块跳过」判定的内容变量(fragment 不算)。 */
export function isContentVariable(name: string): boolean {
  return CONTENT_VAR_NAMES.has(name);
}

/**
 * 变量清单下方的一句通用提示。刻意写成常量而不是散在 UI 模板里:
 * 这两条都是使用者最容易误解的点(为什么块会自己消失、酒馆宏什么时候展开)。
 */
export const PROMPT_VARIABLE_NOTES: readonly string[] = [
  '块里引用的内容变量全部取不到值时,整块不会发送(例如没开角色卡就没有角色卡那一条)。',
  '酒馆自己的宏({{char}}、{{user}}、{{time}} 等)不在上表内:发送前会交给酒馆展开,副 API 渠道同样展开。其中 {{roll}}/{{random}}/{{pick}} 每次取值都可能不同,预览里看到的只是这一次的值。',
];
