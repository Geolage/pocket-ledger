/* 备份与恢复：导出写出来的文件只存在本机；导入会把当前账本整份换掉，所以确认前必须先看一眼。 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TriangleAlertIcon } from "lucide-react";
import type { LedgerApi } from "@/src/hooks/use-ledger";
import { parseBackupJson, recordsToCsv, stateToBackup } from "@/src/lib/backup";
import { downloadTextFile } from "@/src/lib/download";
import { dateKey } from "@/src/lib/ledger";
import { notifyChange, notifyFailure, notifyMessage } from "@/src/lib/ledger-toast";
import type { LedgerState } from "@/src/lib/storage";

const INVALID_BACKUP_MESSAGE = "备份文件格式无效，请重新导出";

/**
 * 设置页那句「系统不会自动覆盖原始数据」在降级视图里是真话，而确认导入是唯一一次用户主动去覆盖它：
 * 这一句必须写在按下确认之前的那块预览里，瞒着这一点，界面就等于撒了谎。
 * 后半句同样是必须的：撤销还原的一直是「按下按钮之前的那一屏」，快照里从来就没有那份原始数据，
 * 不写清楚，一颗「撤销」按钮很容易被读成「覆盖也能退回去」。
 */
const DEGRADED_IMPORT_WARNING =
  "确认导入会覆盖系统保留的那份无法读取的原始数据，覆盖后无法找回；之后的「撤销」只还原导入前的这一屏。";

interface Props {
  ledger: LedgerApi;
}

export function BackupActions({ ledger }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  // 存的是 parseBackupJson 校验过的那份状态，不是文件原文：脏记录、假分类到这里已经不存在了。
  const [pending, setPending] = useState<LedgerState | null>(null);

  /**
   * 预览出现时把焦点交给「确认导入」。不是锦上添花：选完文件焦点本来停在那个 sr-only 的 input 上，
   * 键盘与读屏用户看不见自己刚选中的东西，也摸不到紧接着那颗按钮。
   * 反过来「把焦点还给导入 JSON」不能写在这里——这个 effect 首屏也会跑一次（那时还没有预览），
   * 一加载就把焦点按钮抢下来比丢焦点更莫名，所以交还放在真正关掉预览的那两个动作里。
   */
  useEffect(() => {
    if (pending) confirmButton.current?.focus();
  }, [pending]);

  /** 关掉预览，并把焦点送回它原来站着的地方。 */
  function closePreview() {
    setPending(null);
    importButton.current?.focus();
  }

  function exportJson() {
    downloadTextFile(
      `pocket-ledger-backup-${dateKey(new Date())}.json`,
      stateToBackup(ledger.state),
      "application/json",
    );
    // 导出没写任何东西，也就没资格结束上一步：这句走的是不带撤销位的说明位（见 notifyMessage）。
    notifyMessage("已导出 JSON 备份");
  }

  function exportCsv() {
    downloadTextFile(
      `pocket-ledger-records-${dateKey(new Date())}.csv`,
      recordsToCsv(ledger.records),
      "text/csv",
    );
    notifyMessage(`已导出 ${ledger.records.length} 笔记录`);
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    let parsed: LedgerState | null = null;
    try {
      parsed = parseBackupJson(await file.text());
    } catch {
      // 文件读不出内容（选完就被移走）与读得出却不是备份，对用户是同一句话：这里不能静默失败。
    }
    if (!parsed) {
      // 读不懂这份文件不是账本出了错：这句只占说明位，不该顺手把还挂着的「撤销」按下去。
      notifyFailure(INVALID_BACKUP_MESSAGE);
      // 预览可能已经开着（先选过好文件、这次换了份坏的）。它不会自己消失，
      // 而焦点本来停在那个 sr-only 的 input 上——不关掉，屏幕阅读器读完这句错误就没了下文。
      closePreview();
      return;
    }
    setPending(parsed);
  }

  function confirmImport() {
    if (!pending) return;
    // 先交还焦点再改状态：这颗按钮此刻还挂在树上，等 React 卸载了它，焦点已经无处可放了。
    closePreview();
    const undo = ledger.importState(pending);
    // 导回来的就是当前这本账：那句话不能说成成功，也不该挂一个什么都撤不回来的按钮。
    // 它走说明位还有一个更实在的理由：这一步什么都没改，上一步的撤销因此照样作数，
    // 而 notifyChange 会连按钮一起顶掉。
    if (!undo) {
      notifyMessage("这份备份与当前账本一模一样，没有导入任何内容");
      return;
    }
    // 导入真的换掉了账本，所以它占那个唯一的撤销位，上一步（如果还挂着）到此结束；
    // 上面那两句导出提示则相反——什么都没写，没资格去动那个位置。
    notifyChange(`已导入 ${pending.records.length} 笔记录`, undo);
  }

  return (
    <Card role="region" aria-label="备份与恢复" className="gap-3 p-4 shadow-sm">
      <CardHeader className="px-0">
        <CardTitle className="text-[15px]">备份与恢复</CardTitle>
        <p className="text-xs text-muted-foreground">
          导出的文件保存在本机，不上传。导入 JSON
          会把当前账本整份替换成文件里的内容，替换后仍可撤销一步。
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={exportJson}>
            导出 JSON
          </Button>
          <Button type="button" variant="outline" onClick={exportCsv}>
            导出 CSV
          </Button>
          <Button
            ref={importButton}
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
          >
            导入 JSON
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="选择要导入的 JSON 备份文件"
            className="sr-only"
            onChange={(event) => {
              void chooseFile(event.target.files?.[0]);
              // 选完就把 input 清干净：不清的话，取消一次之后再选同一个文件，
              // 浏览器认为值没变、不再派发 change，那颗按钮就成了死的。
              event.target.value = "";
            }}
          />
        </div>

        {pending && (
          <div role="status" className="rounded-lg bg-muted p-3 text-[13px]">
            <p>
              将导入 {pending.records.length} 笔记录、{Object.keys(pending.budgets).length} 个预算，
              当前账本会被这份文件替换。
            </p>
            {ledger.degraded && (
              // 只有这一句是 alert：整块都标成 assertive，读屏就会连两颗按钮的名字一起打断用户念出来。
              <p role="alert" className="mt-2 flex items-start gap-1.5 font-medium text-warning">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {DEGRADED_IMPORT_WARNING}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button ref={confirmButton} type="button" onClick={confirmImport}>
                确认导入
              </Button>
              <Button type="button" variant="outline" onClick={closePreview}>
                取消
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
