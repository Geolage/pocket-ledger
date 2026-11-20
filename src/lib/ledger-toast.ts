/* 改动结果的提示层：一句带「撤销」的改动回执，一句不带按钮的普通说明。
   放在账本 hook 之外，是因为它只认 sonner，不碰任何状态；哪个消息占哪个位置、停多久，也只在
   这一个文件里定，调用方说不出 id，也就没法伸手进提示层自己的槽位。 */

// UndoAction 只是类型：import type 在编译期就被抹掉，不会让 hook 与提示层互相引用成运行时循环。
import type { UndoAction } from "@/src/hooks/use-ledger";
import { toast } from "sonner";

/**
 * 撤销位：后一条顶掉前一条，屏幕上因此永远最多只有一个「撤销」按钮，
 * 点到的必然是还作数的那一步。多条提示叠着放的话，压在下面那颗按钮既看不见也点不动。
 */
const UNDO_TOAST_ID = "ledger-toast";

/**
 * 说明位：导出成功、文件读不懂这类没得可撤的话。它和撤销位分开，所以一句「已导出 JSON 备份」
 * 不会把还挂着的那颗「撤销」连按钮一起顶掉——可 undoRef 依然认那一步，用户就被界面骗了一次。
 * 同一个位置照样只留最后那一句：连着试几个读不懂的文件，屏幕上不会堆出一串一模一样的话。
 */
const NOTICE_TOAST_ID = "ledger-notice";

/**
 * 撤销只在提示还看得见的那段时间里用得上：默认的 4 秒来不及让人读完再决定，
 * 所以挂着「撤销」的那条单独停留 10 秒。确认框里的说明也照这个数写，两处必须是同一件事。
 */
const UNDO_TOAST_DURATION_MS = 10_000;

/** 撤销窗口以秒为单位说法一致：界面文案直接由它算出来，免得话和实现对不上。 */
export const UNDO_WINDOW_SECONDS = UNDO_TOAST_DURATION_MS / 1000;

/** 点下去却没还回任何东西时要说清原因：静默失败的按钮会让人以为还要再点两下。 */
const UNDO_STALE_MESSAGE = "这一步已经无法撤销，后续改动已经接管了它。";

/**
 * 按下「撤销」：还回来了就把提示收起，已经过期了就换成一句失败说明。
 * 两种情况都不留那颗点不动的按钮。
 */
function runUndo(undo: UndoAction, event?: { preventDefault(): void }): void {
  if (undo()) {
    toast.dismiss(UNDO_TOAST_ID);
    return;
  }
  // 走到这条过期分支只剩一种点得到的方式：提示正在播收起动画的那一小段，按钮还看得见，
  // 但那一步已经被后续改动接管了。为了这一瞬间也留着它——宁可说清失败，也别让按钮静默无效。
  // preventDefault 是与 sonner 的约定：按钮默认会在回调结束后收起提示，
  // 这里要的恰恰是把这条失败说明留在屏幕上。
  event?.preventDefault();
  toast.error(UNDO_STALE_MESSAGE, {
    id: UNDO_TOAST_ID,
    // 同 id 的提示按字段合并：这两个键要显式清掉，否则过期提示会继承上一条的按钮和 10 秒时长。
    action: undefined,
    duration: undefined,
  });
}

/**
 * 改动结果的统一提示：拿到撤销动作才挂「撤销」按钮，并给足点到它的时间。
 * 被领域层拒掉、或者压根没改成的操作返回 null，那种时候挂一个点了没反应的按钮比不挂更糟。
 *
 * action 与 duration 要显式写成 undefined：同 id 的提示是按字段合并的，省掉这些键就会把
 * 上一步的「撤销」按钮和它的 10 秒时长原样留在新的那句话上。
 */
export function notifyChange(message: string, undo: UndoAction | null = null): void {
  toast(message, {
    id: UNDO_TOAST_ID,
    duration: undo ? UNDO_TOAST_DURATION_MS : undefined,
    action: undo ? { label: "撤销", onClick: (event) => runUndo(undo, event) } : undefined,
  });
}

/**
 * 一句没得可撤的说明：导出成功这类「事情办完了」的回执。
 * 它走的是与撤销位分开的说明位——一次导出既没写任何东西，也没让任何一步失效，
 * 也就没资格结束用户真正能撤回去的那一步。
 */
export function notifyMessage(message: string): void {
  toast(message, { id: NOTICE_TOAST_ID });
}

/** 一句没得可撤的失败说明：读不懂的文件、被拒掉的操作，同样只占说明位。 */
export function notifyFailure(message: string): void {
  toast.error(message, { id: NOTICE_TOAST_ID });
}

/**
 * 撤销窗口到此结束时，把挂着它的那条提示一起收掉：按钮只在使用者还看得见时才点得到，
 * 留一颗只会报错的按钮在屏幕上，比用户压根不知道已经错过了更容易伤人。
 * 说明位不动——那句话说的是别的事，跟这一步成不成立没关系。
 */
export function dismissUndoToast(): void {
  toast.dismiss(UNDO_TOAST_ID);
}
