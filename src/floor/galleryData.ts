import { imageDownloadFileName } from '@/floor/download';
import type { LightboxItem } from '@/floor/lightbox';
import { sidecarPathFor } from '@/floor/storage';
import { formatPromptText, parseImageTagContent } from '@/st/imageTagRegex';
import { listUserImageFolders, listUserImages } from '@/st/images';

/**
 * 楼层卡片要按「**同一角色目录**的全部图片」翻页,而图库页那套取数逻辑是页面内的私有函数
 * (它混着体积统计、缓存、多选等页面状态,直接抽出来风险大)。
 *
 * 这里给出**最小可用**的一份:目录名规则、图片 URL、另存名、侧写提示词。
 * ⚠ 与 `pages/gallery/index.vue` 里的同名逻辑是**两份实现** —— 改规则(目录前缀、
 * 下载名格式、侧写字段)时两处都要动。下次有空再统一抽公共模块。
 */

const FOLDER_PREFIX = '柏宝绘_';
/** 侧写请求超时:点开信息框才需要它,不能让服务端把这次点击拖住。 */
const SIDECAR_TIMEOUT_MS = 4000;

/** 逐段编码:服务端对静态路由做 decodeURIComponent,角色名里的 # ? 不编码会被当片段/查询。 */
function imageSrc(folder: string, file: string): string {
  return `/user/images/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
}

/** 从 bbi_<nameHash>_<swipe>_<promptHash>-<genId>.<ext> 取 genId,取不到回退原文件名。 */
function downloadName(characterName: string, file: string): string {
  const genId = file.match(/-([^-.]+)\.[a-z0-9]+$/i)?.[1];
  return genId ? imageDownloadFileName(file, characterName, genId) : file;
}

/**
 * 某角色目录下的全部图片(按文件名顺序)。名称空、目录不存在、读取失败都返回空数组
 * —— 卡片那边拿不到列表时仍能正常打开单图灯箱,只是 A/D 不动。
 */
export async function listCharacterImageItems(characterName: string): Promise<LightboxItem[]> {
  const name = characterName.trim();
  if (!name) return [];
  const folder = `${FOLDER_PREFIX}${name}`;
  try {
    // 先看 /folders 报上来的目录:listUserImages 对不存在的目录会 mkdir,凭空猜名字会攒空文件夹
    const folders = await listUserImageFolders();
    if (!folders.includes(folder)) return [];
    const files = await listUserImages(folder);
    return files.map(file => ({
      src: imageSrc(folder, file),
      filename: downloadName(name, file),
      key: `user/images/${folder}/${file}`,
    }));
  } catch {
    return [];
  }
}

/** 取侧写里的提示词全文。老图没有侧写是常态,任何失败都返回空串(不报错、不拦灯箱)。 */
export async function fetchPromptFor(imagePath: string): Promise<string> {
  const sidecar = sidecarPathFor(imagePath);
  if (!sidecar) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT_MS);
  try {
    const response = await fetch(sidecar, { signal: controller.signal });
    if (!response.ok) return '';
    const data = (await response.json()) as { prompt?: unknown; seed?: unknown };
    if (!data || typeof data.prompt !== 'string' || !data.prompt) return '';
    const text = formatPromptText(parseImageTagContent(data.prompt));
    if (!text) return '';
    return typeof data.seed === 'number' ? `${text}\n\nSeed: ${data.seed}` : text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
