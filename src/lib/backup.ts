/* 备份文件的两端：把账本写成用户能存能改的文本，再把用户递回来的文本读回成校验过的账本。 */

// 显式写 .ts：scripts 下的单元测试用 node --test 直接加载本模块，Node 的 ESM 解析不会补扩展名。
import { type LedgerRecord } from "./ledger.ts";
import { type LedgerState, normalizeLedgerState } from "./storage.ts";

/** 备份负载的格式版本：字段形状以后再变，文件里这一行就是读它的依据。 */
const BACKUP_VERSION = 2;

/** 缩进两格写出来的那份 JSON：备份是给用户存着、甚至手改的，压成一行就没法 diff。 */
export function stateToBackup(state: LedgerState): string {
  return JSON.stringify(
    {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      records: state.records,
      budgets: state.budgets,
      theme: state.theme,
      categories: state.categories,
    },
    null,
    2,
  );
}

const CSV_HEADER = ["id", "type", "amount", "category", "date", "note", "createdAt"];

/**
 * 一个字符串单元格：整格加引号、内容里的引号翻倍，逗号与换行就都关在这一格里。
 * 以 = + - @ 开头的再补一个前引号：表格软件会把这种单元格当公式执行，而备注是用户随手写的话，
 * 不该因为有人写了 `-1+1` 就在别人的表格里算起来。
 */
function csvCell(value: string): string {
  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

/** 账单导出成 CSV：金额与 createdAt 是数字，原样写出去才还能拿去算。 */
export function recordsToCsv(records: readonly LedgerRecord[]): string {
  const rows = records.map((record) =>
    [
      csvCell(record.id),
      csvCell(record.type),
      String(record.amount),
      csvCell(record.category),
      csvCell(record.date),
      // 旧数据里可能压根没有备注这一项（界面把它渲染成「无备注」），这里也按空串写。
      csvCell(record.note ?? ""),
      // 没有写入时刻的记录留一个空数字格：String(undefined) 会在这列本该是数字的地方写出
      // 「undefined」七个字母，而用户是把这份文件拿去表格软件里看的。
      record.createdAt ?? "",
    ].join(","),
  );
  return [CSV_HEADER.join(","), ...rows].join("\n");
}

/**
 * 用户递回来的文件什么都可能写着：JSON 读不出、根不是对象、没有 records 数组的，一律算格式无效，
 * 换一句「重新导出」就好，绝不能导入出一份空账本。
 * 进了这道门的也要整套过一遍 normalizeLedgerState：手改过的记录、恶意拼的分类、不存在的主题，
 * 能落进状态的只有校验得过的那一份。
 */
export function parseBackupJson(raw: string): LedgerState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<LedgerState>;
    if (!Array.isArray(candidate.records)) return null;
    return normalizeLedgerState(candidate);
  } catch {
    // normalizeLedgerState 自己也可能被一份诡异的负载撞抛（比如读到读不动的字段），同样按无效处理。
    return null;
  }
}

/** 把一份文本交给浏览器下载：对象 URL 用完立刻收回，否则它要一直占到这一页关掉为止。 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
