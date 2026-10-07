/**
 * 校验 dist 与源码是否同步(CI 用)。
 *
 * 为什么不直接比较构建产物本身:
 * - Vue 的 scoped 样式会给每个组件算一个 `data-v-<hash>`,**哈希含文件路径** →
 *   换个构建目录(CI 在 D:\a\…,开发者本机在别处)就必然不同;
 * - 产物里还嵌着按工作区换行生成的 sourcesContent(CRLF/LF 不同)。
 * 所以"逐字节比较构建结果"是做不到的,那样的检查只会一直误报。
 *
 * 改为比对 **sourcemap 里内嵌的源码**(sourcesContent):它逐字记录了构建那一刻
 * 每个源文件的内容,与路径无关、与换行无关(这里两边都归一化成 LF 再比)。
 * 只要它与当前工作区的 src/ 一致,就说明 dist 确实是用当前源码构建的。
 *
 * 必须在 `pnpm run build` **之前**跑 —— 构建会重写 dist,把陈旧状态一起抹掉。
 */
import fs from 'node:fs';

const MAP_PATH = 'dist/index.js.map';
const normalize = text => text.replace(/\r\n/g, '\n');

if (!fs.existsSync(MAP_PATH)) {
  console.error(`找不到 ${MAP_PATH}:请先构建并把 dist 一起提交`);
  process.exit(1);
}

let map;
try {
  map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
} catch (error) {
  console.error(`${MAP_PATH} 不是合法 JSON:${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const sources = Array.isArray(map.sources) ? map.sources : [];
const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
const stale = [];
let checked = 0;

for (let index = 0; index < sources.length; index += 1) {
  const source = sources[index];
  const content = contents[index];
  if (typeof source !== 'string' || typeof content !== 'string') continue;
  // sourcemap 的路径相对 dist/ 输出,形如 ../../src/App.vue —— 取出仓库内路径
  const matched = source.match(/(?:\.\.\/)+(src\/.+|vite\.config\.ts)$/);
  if (!matched) continue;
  const relative = matched[1];
  if (!fs.existsSync(relative)) continue;
  checked += 1;
  if (normalize(fs.readFileSync(relative, 'utf8')) !== normalize(content)) stale.push(relative);
}

console.log(`已比对 ${checked} 个源文件`);
if (checked === 0) {
  console.error('一个源文件都没比对上:sourcemap 结构可能变了,请检查本脚本的路径规则');
  process.exit(1);
}
if (stale.length) {
  console.error('dist 与源码不同步 —— 下列文件在构建之后被改过:');
  for (const file of stale.slice(0, 20)) console.error(`  - ${file}`);
  console.error('请在本地执行 pnpm run build,并把 dist 一起提交');
  process.exit(1);
}
console.log('dist 与源码同步 ✓');
