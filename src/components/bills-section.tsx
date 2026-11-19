import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PencilIcon, Trash2Icon } from "lucide-react";
import {
  type CategoryColorIndex,
  type LedgerRecord,
  colorOf,
  money,
  monthLabel,
  parseDate,
} from "@/src/lib/ledger";
import type { Filters, LedgerApi } from "@/src/hooks/use-ledger";

interface Props {
  ledger: LedgerApi;
  onAdd: () => void;
  onEdit: (record: LedgerRecord) => void;
  onDelete: (record: LedgerRecord) => void;
}

export function BillsSection({ ledger, onAdd, onEdit, onDelete }: Props) {
  const { visibleRecords, monthCount, filters } = ledger;
  const net = visibleRecords.reduce(
    (sum, record) =>
      sum +
      (record.type === "expense"
        ? -Math.round(record.amount * 100)
        : Math.round(record.amount * 100)),
    0,
  );

  const setFilters = ledger.setFilters;
  const update = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  return (
    <section id="bills" className="scroll-mt-20">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">账单</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
          {monthCount === 0
            ? `${monthLabel(ledger.year, ledger.month)}还没有记录`
            : `显示 ${visibleRecords.length} / ${monthCount} 笔 · 净额 ${money(net / 100)}`}
        </p>
      </div>

      <form
        role="search"
        aria-label="筛选账单"
        onSubmit={(event) => event.preventDefault()}
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(9rem,1fr)_minmax(10rem,1.2fr)_minmax(12rem,2fr)_auto] lg:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="filter-type">类型</Label>
          <Select
            value={filters.type}
            onValueChange={(value) => update({ type: value as Filters["type"] })}
          >
            <SelectTrigger id="filter-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="expense">支出</SelectItem>
              <SelectItem value="income">收入</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="filter-category">分类</Label>
          <Select value={filters.category} onValueChange={(value) => update({ category: value })}>
            <SelectTrigger id="filter-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {/* 候选来自账本的分类定义：启用的分类 + 本月记录里用过的分类，
                  停用后仍留有账单的分类要能筛得出来。filters.category 已经由 hook 按这份
                  候选归一化，所以分类被改名或删除后，这里显示的就是「全部分类」而不是旧名字。 */}
              {ledger.filterCategoryOptions.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="filter-keyword">关键词</Label>
          <Input
            id="filter-keyword"
            type="search"
            placeholder="搜索备注或分类"
            autoComplete="off"
            value={filters.keyword}
            onChange={(event) => update({ keyword: event.target.value })}
          />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={ledger.resetFilters}
          className="justify-self-start lg:justify-self-auto"
        >
          清除筛选
        </Button>
      </form>

      {visibleRecords.length === 0 ? (
        <div className="mt-3 grid justify-items-center gap-2 rounded-xl border border-dashed border-input bg-surface-soft px-4 py-8 text-center">
          <p className="text-sm font-medium">
            {monthCount === 0
              ? `${monthLabel(ledger.year, ledger.month)}还没有记录`
              : "没有符合筛选条件的账单"}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {monthCount === 0
              ? "点「记一笔」记下第一笔收支。"
              : `本月有 ${monthCount} 笔记录，试着换个关键词或清除筛选。`}
          </p>
          {monthCount === 0 && (
            <Button type="button" onClick={onAdd}>
              记一笔
            </Button>
          )}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visibleRecords.map((record, index) => {
            const previous = visibleRecords[index - 1];
            const showDay = !previous || previous.date !== record.date;
            return (
              <BillRow
                key={record.id}
                record={record}
                showDay={showDay}
                colors={ledger.categoryColors}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BillRow({
  record,
  showDay,
  colors,
  onEdit,
  onDelete,
}: {
  record: LedgerRecord;
  showDay: boolean;
  /** 分类色索引：由 hook 跟着分类列表一起缓存，一笔账单取一次色，不再扫整张表。 */
  colors: CategoryColorIndex;
  onEdit: (record: LedgerRecord) => void;
  onDelete: (record: LedgerRecord) => void;
}) {
  const date = parseDate(record.date);
  const weekday = date
    ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]
    : "";

  return (
    <>
      {showDay && date && (
        <li className="bg-surface-soft px-4 py-2 text-xs text-muted-foreground tabular-nums">
          {date.getMonth() + 1} 月 {date.getDate()} 日 · {weekday}
        </li>
      )}
      <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto_auto]">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-lg text-[13px] font-semibold text-white"
          style={{ background: colorOf(colors, record.category, record.type) }}
        >
          {record.category.charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{record.category}</span>
          <span className="block truncate text-xs text-faint">{record.note || "无备注"}</span>
        </span>
        <span
          className={[
            "col-start-3 row-start-1 justify-self-end text-[15px] font-semibold tabular-nums sm:col-start-3 sm:row-start-auto",
            record.type === "income" ? "text-positive" : "text-foreground",
          ].join(" ")}
        >
          {record.type === "income" ? "+" : "−"}
          {money(record.amount)}
        </span>
        <span className="col-span-3 flex justify-end gap-1 sm:col-span-1 sm:col-start-4">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(record)}
            aria-label={`编辑 ${record.category} ${money(record.amount)}`}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(record)}
            aria-label={`删除 ${record.category} ${money(record.amount)}`}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-negative"
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </span>
      </li>
    </>
  );
}
