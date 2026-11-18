import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { THEMES, type ThemeId } from "@/src/lib/themes";
import { storedBytes } from "@/src/lib/storage";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
  onResetDemo: () => void;
  onWipe: () => void;
}

export function SettingsSection({ ledger, onResetDemo, onWipe }: Props) {
  const budgetCount = Object.keys(ledger.budgets).length;
  const kilobytes = (storedBytes() / 1024).toFixed(1);

  return (
    <section id="settings" className="scroll-mt-20">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">设置</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          主题与数据都保存在本机浏览器，换设备或清除浏览器数据后不会同步。
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="gap-3 p-4 shadow-sm">
          <CardHeader className="px-0">
            <CardTitle className="text-[15px]">配色主题</CardTitle>
            <p className="text-xs text-muted-foreground">
              三套淡蓝绿主题，切换后立即生效并记住选择。
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <RadioGroup
              value={ledger.theme}
              onValueChange={(value) => ledger.setTheme(value as ThemeId)}
              className="grid gap-2 sm:grid-cols-3"
              aria-label="配色主题"
            >
              {THEMES.map((theme) => (
                <Label
                  key={theme.id}
                  className={[
                    "flex h-full cursor-pointer flex-col items-start gap-2 rounded-xl border p-3 transition-colors",
                    ledger.theme === theme.id
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border bg-surface-soft hover:border-primary/60",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-2">
                    <RadioGroupItem value={theme.id} />
                    <span className="text-[13px] font-medium">{theme.name}</span>
                  </span>
                  <span className="flex gap-1" aria-hidden="true">
                    {theme.swatches.map((color) => (
                      <span
                        key={color}
                        className="size-4 rounded-md ring-1 ring-black/5"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {theme.tagline}
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card className="gap-3 p-4 shadow-sm">
          <CardHeader className="px-0">
            <CardTitle className="text-[15px]">数据与隐私</CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              本机已保存 {ledger.records.length} 笔记录、{budgetCount} 个分类预算，约占 {kilobytes}{" "}
              KB。
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 px-0">
            <ul className="grid gap-1.5 text-[13px] text-muted-foreground">
              <li>
                账单、预算和主题保存在浏览器的 localStorage 中，
                <strong className="font-medium text-foreground">不会连接任何银行账户</strong>
                ，也不会上传。
              </li>
              <li>
                当前账本为<strong className="font-medium text-foreground">演示数据</strong>
                ：人物、商户与金额均为虚构，不构成任何理财或投资建议。
              </li>
            </ul>
            {!ledger.storageAvailable && (
              <p role="alert" className="text-[13px] text-negative">
                浏览器拒绝写入本地存储，本次修改只保留在当前页面。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onResetDemo}>
                恢复演示数据
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onWipe}
                className="text-negative hover:bg-destructive/10"
              >
                清空所有数据
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
