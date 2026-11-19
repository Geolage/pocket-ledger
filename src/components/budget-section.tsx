import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CircleAlertIcon } from "lucide-react";
import { categoriesFor, cents, fromCents, money } from "@/src/lib/ledger";
import type { LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
  onClearBudget: (category: string) => void;
}

/* 报错位各管各的控件：缺分类是分类选择器的问题，不该让金额输入框挂上无效状态。 */
const AMOUNT_ERROR_ID = "budget-amount-error";
const CATEGORY_ERROR_ID = "budget-category-error";

export function BudgetSection({ ledger, onClearBudget }: Props) {
  // 预算只能挂在启用中的支出分类上：自定义分类进候选，停用的分类要跟着出去。
  const options = categoriesFor("expense", ledger.categories);
  const [picked, setPicked] = useState("");
  // 一个启用中的支出分类都没有时留空串：下面所有涉及分类的动作都要先看过它才知道能不能做。
  const category = options.includes(picked) ? picked : (options[0] ?? "");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [categoryError, setCategoryError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) {
      setCategoryError("请先在「分类管理」里启用至少一个支出分类。");
      return;
    }
    const raw = amount.replace(/[，,\s¥]/g, "");
    const value = Number(raw);
    if (raw === "" || Number.isNaN(value) || value < 0) {
      setAmountError("请输入不小于 0 的预算金额");
      return;
    }
    if (value > 999999) {
      setAmountError("预算金额请不超过 ¥999,999");
      return;
    }
    setAmountError("");
    setCategoryError("");
    ledger.setBudget(category, fromCents(cents(value)));
    setAmount("");
  }

  return (
    <section id="budget" className="scroll-mt-20">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">分类预算</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          为每个支出分类设置每月预算，超出时这里和本月概览都会提示。
        </p>
      </div>

      {ledger.budget.rows.length === 0 ? (
        <p className="mb-3 rounded-xl border border-dashed border-input bg-surface-soft px-4 py-6 text-center text-[13px] text-muted-foreground">
          还没有设置任何分类预算，用下面的表单添加第一个。
        </p>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ledger.budget.rows.map((row) => (
            <Card
              key={row.category}
              className={["gap-2 p-4 shadow-sm", row.over ? "border-destructive" : ""].join(" ")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{row.category}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {money(row.spent)} / {money(row.budget)}
                </p>
              </div>
              <Progress
                value={Math.min(100, row.pct)}
                aria-label={`${row.category} 预算使用 ${Math.round(row.pct)}%`}
                className={[
                  "h-2 bg-muted",
                  row.over
                    ? "[&>[data-slot=progress-indicator]]:bg-destructive"
                    : row.near
                      ? "[&>[data-slot=progress-indicator]]:bg-warning"
                      : "[&>[data-slot=progress-indicator]]:bg-primary",
                ].join(" ")}
              />
              <p
                className={[
                  "text-xs tabular-nums",
                  row.over ? "font-medium text-negative" : "text-muted-foreground",
                ].join(" ")}
              >
                {row.over
                  ? `已超支 ${money(row.spent - row.budget)}`
                  : `剩余 ${money(row.remaining)} · 已用 ${Math.round(row.pct)}%`}
              </p>
            </Card>
          ))}
        </div>
      )}

      <form
        onSubmit={submit}
        noValidate
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="budget-category">分类</Label>
          <Select
            value={category}
            onValueChange={(value) => {
              setPicked(value);
              // 选上分类就说明候选项回来了，这条报错得跟着收掉。
              setCategoryError("");
            }}
          >
            <SelectTrigger
              id="budget-category"
              className="w-full"
              aria-invalid={categoryError ? true : undefined}
              aria-describedby={categoryError ? CATEGORY_ERROR_ID : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ErrorText id={CATEGORY_ERROR_ID} message={categoryError} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="budget-amount">每月预算（元）</Label>
          <Input
            id="budget-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="例如 1500"
            value={amount}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? AMOUNT_ERROR_ID : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setAmountError("");
            }}
          />
          <ErrorText id={AMOUNT_ERROR_ID} message={amountError} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">保存预算</Button>
          {/* 没有可用分类时「取消该分类预算」压根不知道该取消谁：按钮直接 disable，
              而不是把 undefined 递出去。 */}
          <Button
            type="button"
            variant="outline"
            onClick={() => onClearBudget(category)}
            disabled={!category}
          >
            取消该分类预算
          </Button>
        </div>
      </form>
    </section>
  );
}

/** 报错只说明它所属的那个控件：role="alert" 让屏幕阅读器念出来，id 给对应控件引用。 */
function ErrorText({ id, message }: { id: string; message: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-[13px] text-negative">
      <CircleAlertIcon className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
}
