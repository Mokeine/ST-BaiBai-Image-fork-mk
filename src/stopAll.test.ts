import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * 「停止当前请求」的收口点。
 *
 * 这里只钉住**接线**:一次点击必须同时叫停四个子系统(少一个都会留下"还在跑"的错觉),
 * 以及按钮的启用判据(tag 在途 or 生图在途)。各子系统自己的行为由它们的测试覆盖:
 * floor/genState.test.ts(clearAllGen 中止全部)、floor/autoGenerate.test.ts(标记)、
 * floor/tagPlanState.test.ts(展示态)。
 */
const mocks = vi.hoisted(() => ({
  stopAllTagRuns: vi.fn(),
  clearAllGen: vi.fn(),
  clearAutoGenerateFlags: vi.fn(),
  clearAllTagPlans: vi.fn(),
  genCount: 0,
}));

vi.mock('@/autoTag/runner', () => ({
  stopAllTagRuns: mocks.stopAllTagRuns,
  // 必须是 reactive 代理:hasRunningWork 的响应式就靠它。
  // ⚠ 测试里要改这个值时也得走**代理**(import 回来的那个),直接改原始对象不会触发通知。
  tagRunState: reactive({ active: 0 }),
}));
vi.mock('@/floor/genState', () => ({
  clearAllGen: mocks.clearAllGen,
  activeGenCount: () => mocks.genCount,
}));
vi.mock('@/floor/autoGenerate', () => ({ clearAutoGenerateFlags: mocks.clearAutoGenerateFlags }));
vi.mock('@/floor/tagPlanState', () => ({ clearAllTagPlans: mocks.clearAllTagPlans }));

describe('stopAllRequests / hasRunningWork', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.genCount = 0;
    const { tagRunState } = await import('@/autoTag/runner');
    tagRunState.active = 0;
  });

  it('一次点击叫停四个子系统:tag 请求、生图、自动出图标记、重写展示态', async () => {
    const { stopAllRequests } = await import('@/stopAll');
    stopAllRequests();
    expect(mocks.stopAllTagRuns).toHaveBeenCalledTimes(1);
    expect(mocks.clearAllGen).toHaveBeenCalledTimes(1);
    expect(mocks.clearAutoGenerateFlags).toHaveBeenCalledTimes(1);
    expect(mocks.clearAllTagPlans).toHaveBeenCalledTimes(1);
  });

  it('没有在途工作时 hasRunningWork 为假(按钮置灰)', async () => {
    const { hasRunningWork } = await import('@/stopAll');
    expect(hasRunningWork()).toBe(false);
  });

  it('tag 请求在途或在生图,都算"有在途工作"', async () => {
    const { hasRunningWork } = await import('@/stopAll');
    const { tagRunState } = await import('@/autoTag/runner');
    tagRunState.active = 2;
    expect(hasRunningWork()).toBe(true);
    tagRunState.active = 0;
    mocks.genCount = 1;
    expect(hasRunningWork()).toBe(true);
  });

  it('hasRunningWork 读的是响应式状态(能在 computed 里跟着变)', async () => {
    const { hasRunningWork } = await import('@/stopAll');
    const { tagRunState } = await import('@/autoTag/runner');
    const { computed } = await import('vue');
    const flag = computed(() => hasRunningWork());
    expect(flag.value).toBe(false);
    tagRunState.active = 1;
    expect(flag.value).toBe(true);
    tagRunState.active = 0;
    expect(flag.value).toBe(false);
  });
});
