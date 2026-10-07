/**
 * 「停止当前请求」的收口点(入口是请求历史页那个独立按钮)。
 *
 * 一次点击要同时按下四个刹车,少一个都会留下"点了停止还在跑"的错觉:
 * 1. **在途的 tag 请求**(副 API 或跟随主 API)+ 排队待跑的 + 生成闸门 —— 见
 *    autoTag/runner.ts 的 stopAllTagRuns。中止后 runner 会在每处 `signal.aborted`
 *    检查点直接收手:不重试、不写回正文、也不挂"自动出图"标记。
 * 2. **在途的生图请求**(floor/genState 的 clearAllGen):NAI 与 ComfyUI 都在里面。
 * 3. **已挂上但还没被消费的「自动出图」标记**(floor/autoGenerate):不清掉的话,
 *    楼层下一次重渲染时它照样会开跑 —— 用户看到的就是"停止之后还在出图"。
 * 4. **「AI 重写提示词」的展示态**(floor/tagPlanState):它的在途请求就是第 1 条里
 *    那把每楼一把的锁,这里只需把展示态清掉,免得卡片永远停在"重写中…"。
 *
 * 刻意**不动** `autoTag.enabled`:这是"停这一次",不是"关掉自动流程"。后续新楼层的
 * 自动 tag 照常发生,想长期关掉请去设置页关那个总开关。
 *
 * 历史记录不需要在这里处理:被中止的请求由 api/client 记成 `status='aborted'`
 * (页面上显示「已取消」,与红色报错分开)。
 */
import { stopAllTagRuns, tagRunState } from '@/autoTag/runner';
import { clearAutoGenerateFlags } from '@/floor/autoGenerate';
import { activeGenCount, clearAllGen } from '@/floor/genState';
import { clearAllTagPlans } from '@/floor/tagPlanState';

/** 停掉当前所有在途工作,并掐断后续的自动尝试。无在途时是安全空操作。 */
export function stopAllRequests(): void {
  stopAllTagRuns();
  clearAllGen();
  clearAutoGenerateFlags();
  clearAllTagPlans();
}

/**
 * 当前是否有在途工作(tag 请求或生图)。
 * 读的都是响应式状态,所以可以直接放进 computed —— 按钮的置灰跟着它走。
 */
export function hasRunningWork(): boolean {
  return tagRunState.active > 0 || activeGenCount() > 0;
}
