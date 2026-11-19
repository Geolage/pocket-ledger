import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CircleAlertIcon } from "lucide-react";
import {
  type CategoryDefinition,
  type LedgerRecord,
  type RecordType,
  categoriesFor,
  cents,
  dateKey,
  fromCents,
  parseDate,
} from "@/src/lib/ledger";
import type { RecordDraft } from "@/src/hooks/use-ledger";

interface Props {
  open: boolean;
  record: LedgerRecord | null;
  /** 账本里的分类定义：候选项只能取其中启用的那些，自定义分类也一起跟着走。 */
  categories: CategoryDefinition[];
  onOpenChange: (open: boolean) => void;
  onSave: (draft: RecordDraft) => void;
}

interface FormState {
  type: RecordType;
  amount: string;
  category: string;
  date: string;
  note: string;
}

function initialState(record: LedgerRecord | null, categories: CategoryDefinition[]): FormState {
  if (record) {
    // 分类停用也要保住这条记录自己的分类，否则旧账单既读不回也改不了。
    return {
      type: record.type,
      amount: String(record.amount),
      category: record.category,
      date: record.date,
      note: record.note ?? "",
    };
  }
  return {
    type: "expense",
    amount: "",
    // 一个启用分类都没有时留空字符串而不是 undefined：下面提交要按「有没有分类」报错，
    // 而 undefined 会一路摸进 addRecord，把必填的分类写成脏数据。
    category: categoriesFor("expense", categories)[0] ?? "",
    date: dateKey(new Date()),
    note: "",
  };
}

export function RecordDialog({ open, record, categories, onOpenChange, onSave }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(record, categories));
  const [errors, setErrors] = useState<{ amount?: string; category?: string; date?: string }>({});

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));

  // 停用的分类不进候选；只有手上这条记录用它时，才把它留在选项里。
  const enabled = categoriesFor(form.type, categories);
  const options =
    form.category && !enabled.includes(form.category) ? [form.category, ...enabled] : enabled;

  function clearCategoryError() {
    // 动过分类就把这条错误撤掉：留着会让控件在已经修好之后仍然报无效。
    setErrors((current) => (current.category ? { ...current, category: undefined } : current));
  }

  function changeType(type: RecordType) {
    const list = categoriesFor(type, categories);
    patch({ type, category: list.includes(form.category) ? form.category : (list[0] ?? "") });
    clearCategoryError();
  }

  function changeCategory(category: string) {
    patch({ category });
    clearCategoryError();
  }

  function submit() {
    const raw = form.amount.replace(/[，,\s¥]/g, "");
    const value = Number(raw);
    const next: { amount?: string; category?: string; date?: string } = {};

    if (raw === "" || Number.isNaN(value) || value <= 0) next.amount = "请输入大于 0 的金额";
    else if (value > 999999) next.amount = "单笔金额请不超过 ¥999,999";
    else if (fromCents(cents(value)) !== value) next.amount = "金额最多保留两位小数";

    // 分类是记录的一部分，不是可有可无的装饰：空值直接拦下，绝不带着 undefined 去存。
    const category = form.category.trim();
    if (!category) next.category = "请选择分类";

    const date = parseDate(form.date);
    if (!date) next.date = "请选择日期";
    else if (date.getFullYear() < 2000 || date.getFullYear() > 2100)
      next.date = "年份请在 2000 – 2100 之间";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSave({
      type: form.type,
      amount: fromCents(cents(value)),
      category,
      date: form.date,
      note: form.note.trim().slice(0, 40),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{record ? "编辑这笔" : "记一笔"}</DialogTitle>
          <DialogDescription>
            金额与日期会立即重算本月统计；数据只写在本机浏览器。
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <RadioGroup
            value={form.type}
            onValueChange={(value) => changeType(value as RecordType)}
            aria-label="收支类型"
            className="grid grid-cols-2 gap-1 rounded-full border border-border bg-muted p-1"
          >
            {(["expense", "income"] as const).map((type) => (
              <Label
                key={type}
                className={[
                  "flex cursor-pointer justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium",
                  form.type === type ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                <RadioGroupItem value={type} className="sr-only" />
                {type === "expense" ? "支出" : "收入"}
              </Label>
            ))}
          </RadioGroup>

          <div className="grid gap-1.5">
            <Label htmlFor="record-amount">金额（元）</Label>
            <Input
              id="record-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={form.amount}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? "record-amount-error" : undefined}
              onChange={(event) => patch({ amount: event.target.value })}
            />
            <FieldError id="record-amount-error" message={errors.amount} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="record-category">分类</Label>
            <Select value={form.category} onValueChange={changeCategory}>
              <SelectTrigger
                id="record-category"
                className="w-full"
                aria-invalid={errors.category ? true : undefined}
                aria-describedby={errors.category ? "record-category-error" : undefined}
              >
                <SelectValue placeholder="请选择分类" />
              </SelectTrigger>
              <SelectContent>
                {options.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="record-category-error" message={errors.category} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="record-date">日期</Label>
            <Input
              id="record-date"
              type="date"
              value={form.date}
              aria-invalid={errors.date ? true : undefined}
              aria-describedby={errors.date ? "record-date-error" : undefined}
              onChange={(event) => patch({ date: event.target.value })}
            />
            <FieldError id="record-date-error" message={errors.date} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="record-note">
              备注 <span className="font-normal text-faint">（选填，最多 40 字）</span>
            </Label>
            <Input
              id="record-note"
              maxLength={40}
              autoComplete="off"
              placeholder="例如：楼下便利店"
              value={form.note}
              onChange={(event) => patch({ note: event.target.value })}
            />
          </div>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-[13px] text-negative">
      <CircleAlertIcon className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
}
