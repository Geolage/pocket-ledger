/* 备份文件的两端：把账本写成用户能存能改的文本，再把用户递回来的文本读回成校验过的账本。
   这一对只做解析与格式化：交给浏览器的动作在 src/lib/download.ts，本模块因此在 Node 里也跑得动。 */

// 显式写 .ts：scripts 下的单元测试用 node --test 直接加载本模块，Node 的 ESM 解析不会补扩展名。
import { type LedgerRecord } from "./ledger.ts";
import { type LedgerState, normalizeLedgerState } from "./storage.ts";

/** 备份负载的格式版本：字段形状以后再变，文件里这一行就是读它的依据。 */
const BACKUP_VERSION = 2;

/**
 * 比 BACKUP_VERSION 还新的文件一律不读：这一行存在的唯一理由，就是让以后改了字段形状时能把
 * 「这份我不认识」说清楚，而不是半生不熟地硬读出一份看着完整、其实缺了新一维的账本。
 * 读不出数字的（缺着这一行、写着 "昨天"）不算「更新」：老文件本来就没有版本号，
 * 而能落进状态的字段自有 normalizeLedgerState 把关。
 */
function isFromTheFuture(version: unknown): boolean {
  const value = Number(version);
  return Number.isFinite(value) && value > BACKUP_VERSION;
}

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
 * 表格软件认的 UTF-8 记号。charset=utf-8 那层声明只写在 MIME 头里，落到磁盘上的文件谁也不知道它
 * 声明过，中文 Windows 上的 Excel 于是按 GBK 去猜，餐饮与备注一律变乱码——BOM 是它唯一看得见的说法。
 * 写成代码点而不是转义：那个字符在源码里根本看不见，一个数才读得懂这里写的是什么。
 */
const CSV_BOM = String.fromCodePoint(0xfeff);

/** RFC 4180 把 CRLF 定为行尾，Excel 与 Windows 记事本都按它读：只给 LF 能被连成一行。 */
const CSV_LINE_END = "\r\n";

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
  // 末行不补行尾：表头下面多出一行空的，Excel 里看着就像一笔没写内容的账。
  return CSV_BOM + [CSV_HEADER.join(","), ...rows].join(CSV_LINE_END);
}

/**
 * 用户递回来的文件什么都可能写着：JSON 读不出、根不是对象、没有 records 数组的、版本比当前还新的，
 * 一律算格式无效，换一句「重新导出」就好，绝不能导入出一份空账本。
 * 进了这道门的也要整套过一遍 normalizeLedgerState：手改过的记录、恶意拼的分类、不存在的主题，
 * 能落进状态的只有校验得过的那一份。
 */
export function parseBackupJson(raw: string): LedgerState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<LedgerState> & { version?: unknown };
    if (isFromTheFuture(candidate.version)) return null;
    if (!Array.isArray(candidate.records)) return null;
    return normalizeLedgerState(candidate);
  } catch (error) {
    // normalizeLedgerState 自己也可能被一份诡异的负载撞抛（比如读到读不动的字段），同样按无效处理。
    // 但那是归一化代码的问题，不是用户那份文件的问题：界面上只有「重新导出」这一句话可说，
    // 现场就得留在控制台里，否则修 bug 的人连一条线索都拿不到。
    console.debug("备份读取失败，界面按格式无效处理", error);
    return null;
  }
}
