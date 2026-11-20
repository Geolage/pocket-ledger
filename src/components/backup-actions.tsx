/* 备份与恢复：导出写出来的文件只存在本机；导入会把当前账本整份换掉，所以确认前必须先看一眼。 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import type { LedgerApi } from "@/src/hooks/use-ledger";
import { downloadTextFile, parseBackupJson, recordsToCsv, stateToBackup } from "@/src/lib/backup";
import { dateKey } from "@/src/lib/ledger";
import { LEDGER_TOAST_ID, notifyChange } from "@/src/lib/ledger-toast";
import type { LedgerState } from "@/src/lib/storage";

const INVALID_BACKUP_MESSAGE = "备份文件格式无效，请重新导出";

/**
 * 设置页那句「系统不会自动覆盖原始数据」在降级视图里是真话，而确认导入是唯一一次用户主动去覆盖它：
 * 这一句必须写在按下确认之前的那块预览里，瞒着这一点，界面就等于撒了谎。
 */
const DEGRADED_IMPORT_WARNING = "确认导入会覆盖系统保留的那份无法读取的原始数据，覆盖后无法找回。";

interface Props {
  ledger: LedgerApi;
}

export function BackupActions({ ledger }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  // 存的是 parseBackupJson 校验过的那份状态，不是文件原文：脏记录、假分类到这里已经不存在了。
  const [pending, setPending] = useState<LedgerState | null>(null);

  function exportJson() {
    downloadTextFile(
      `pocket-ledger-backup-${dateKey(new Date())}.json`,
      stateToBackup(ledger.state),
      "application/json",
    );
    notifyChange("已导出 JSON 备份");
  }

  function exportCsv() {
    downloadTextFile(
      `pocket-ledger-records-${dateKey(new Date())}.csv`,
      recordsToCsv(ledger.records),
      "text/csv",
    );
    notifyChange(`已导出 ${ledger.records.length} 笔记录`);
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
      // 也走那个唯一的提示位：连着试几个读不懂的文件，屏幕上不会堆出一串一模一样的话。
      toast.error(INVALID_BACKUP_MESSAGE, { id: LEDGER_TOAST_ID });
      return;
    }
    setPending(parsed);
  }

  function confirmImport() {
    if (!pending) return;
    setPending(null);
    const undo = ledger.importState(pending);
    // 导回来的就是当前这本账：那句话不能说成成功，也不该挂一个什么都撤不回来的按钮。
    notifyChange(
      undo
        ? `已导入 ${pending.records.length} 笔记录`
        : "这份备份与当前账本一模一样，没有导入任何内容",
      undo,
    );
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
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
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
          <div role="alert" className="rounded-lg bg-muted p-3 text-[13px]">
            <p>
              将导入 {pending.records.length} 笔记录、{Object.keys(pending.budgets).length} 个预算，
              当前账本会被这份文件替换。
            </p>
            {ledger.degraded && (
              <p className="mt-2 flex items-start gap-1.5 font-medium text-warning">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {DEGRADED_IMPORT_WARNING}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={confirmImport}>
                确认导入
              </Button>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                取消
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
