/* 分类管理：自定义分类的新增、改名、停用与删除。内置分类只允许停用。 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CircleAlertIcon, PencilIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import type { DeleteCategoryFailure } from "@/src/lib/categories";
import type { LedgerApi } from "@/src/hooks/use-ledger";
import { type CategoryDefinition, type RecordType } from "@/src/lib/ledger";

/** 分类名是预算与图表的键，也是列表里要读得清的一行字，所以限长；超长输入直接拒绝。 */
const MAX_NAME_LENGTH = 12;

const TYPE_LABEL: Record<RecordType, string> = { expense: "支出", income: "收入" };

const DUPLICATE_NAME = "已有同名分类，请换一个名字";
const UNCHANGED_NAME = "分类名称未变化";
const LAST_ENABLED_DELETE = "删除失败：每个类型至少需要保留一个启用分类";

/* 三个报错位各管各的控件：新增与改名是两个独立输入框，共用一份报错就会互相染上 aria-invalid。 */
const ADD_ERROR_ID = "category-add-error";
const RENAME_ERROR_ID = "category-rename-error";
const ACTION_ERROR_ID = "category-action-error";

interface Props {
  ledger: LedgerApi;
}

interface Renaming {
  id: string;
  value: string;
  /** 打开编辑器时的名字：比对它就能分清「没改动」和「撞名」，不用回头查列表。 */
  original: string;
}

/** 三道校验：空、超长、重名。重名跨支出与收入，因为预算与颜色都按名字取值。 */
function validateName(
  raw: string,
  categories: readonly CategoryDefinition[],
  exceptId?: string,
): { name: string; error: string } {
  const name = raw.trim();
  if (!name) return { name, error: "请输入分类名称" };
  if (name.length > MAX_NAME_LENGTH)
    return { name, error: `分类名称请不超过 ${MAX_NAME_LENGTH} 个字` };
  if (categories.some((category) => category.name === name && category.id !== exceptId))
    return { name, error: DUPLICATE_NAME };
  return { name, error: "" };
}

/** 删除失败的原因由领域层给出，这里只负责翻成人话。 */
function deleteFailureMessage(name: string, failure: DeleteCategoryFailure): string {
  if (failure === "last-enabled") return LAST_ENABLED_DELETE;
  if (failure === "in-use") return `${name} 还有账单在用，删不掉，可以先停用。`;
  return `${name} 删不掉，请刷新后重试。`;
}

export function CategoryManager({ ledger }: Props) {
  const [type, setType] = useState<RecordType>("expense");
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [addError, setAddError] = useState("");
  const [renameError, setRenameError] = useState("");
  const [actionError, setActionError] = useState("");

  const listed = ledger.categories.filter((category) => category.type === type);
  // 「有没有被用」按当前类型的记录判断，和 deleteUnusedCategory 的口径保持一致。
  const usedNames = new Set(
    ledger.records.filter((record) => record.type === type).map((record) => record.category.trim()),
  );

  function create() {
    const { name, error: message } = validateName(draft, ledger.categories);
    if (message) {
      setAddError(message);
      return;
    }
    // 领域层还会把一轮查重，失败同样要让用户看见，不然点了像没反应。
    if (!ledger.addCategory(type, name)) {
      setAddError(DUPLICATE_NAME);
      return;
    }
    setDraft("");
    setAddError("");
  }

  function startRename(category: CategoryDefinition) {
    setRenameError("");
    setRenaming({ id: category.id, value: category.name, original: category.name });
  }

  function cancelRename() {
    setRenaming(null);
    setRenameError("");
  }

  function commitRename() {
    if (!renaming) return;
    const { name, error: message } = validateName(renaming.value, ledger.categories, renaming.id);
    if (message) {
      setRenameError(message);
      return;
    }
    // 先跟当前名字比一次再去调用：领域层对「没变化的改名」也返回 null，
    // 不先区分就会把没改动误报成重名。
    if (name === renaming.original) {
      setRenameError(UNCHANGED_NAME);
      return;
    }
    if (!ledger.renameCategoryAction(renaming.id, name)) {
      setRenameError(DUPLICATE_NAME);
      return;
    }
    setRenaming(null);
    setRenameError("");
  }

  function toggle(category: CategoryDefinition) {
    if (ledger.toggleCategoryAction(category.id)) {
      setActionError("");
      return;
    }
    // 领域层拒绝把某种类型用到一个分类都不剩，这里如实说明而不是让按钮看起来坏了。
    setActionError(
      `「${category.name}」停用失败：${TYPE_LABEL[category.type]}分类需至少保留一个启用分类。`,
    );
  }

  function remove(category: CategoryDefinition) {
    const failure = ledger.deleteCategoryAction(category.id);
    if (!failure) {
      setActionError("");
      return;
    }
    setActionError(deleteFailureMessage(category.name, failure));
  }

  return (
    <Card role="region" aria-label="分类管理" className="gap-3 p-4 shadow-sm">
      <CardHeader className="px-0">
        <CardTitle className="text-[15px]">分类管理</CardTitle>
        <p className="text-xs text-muted-foreground">
          自定义分类可以改名与删除，内置分类只能停用。停用的分类不再出现在记一笔与预算的候选里，已有账单保持原样。
        </p>
      </CardHeader>

      <CardContent className="grid gap-3 px-0">
        <form
          className="grid gap-2 sm:grid-cols-[minmax(7rem,1fr)_minmax(9rem,2fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="category-type">分类类型</Label>
            <Select
              value={type}
              onValueChange={(value) => {
                setType(value as RecordType);
                // 换类型会换掉整份列表，改名的草稿已经无处可归，这里明确取消而不是悄悄丢掉。
                cancelRename();
                setAddError("");
                setActionError("");
              }}
            >
              <SelectTrigger
                id="category-type"
                aria-label="分类类型"
                className="w-full"
                aria-describedby={addError ? ADD_ERROR_ID : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABEL) as RecordType[]).map((item) => (
                  <SelectItem key={item} value={item}>
                    {TYPE_LABEL[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="category-new-name">新分类名称</Label>
            <Input
              id="category-new-name"
              autoComplete="off"
              placeholder="例如：宠物"
              value={draft}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? ADD_ERROR_ID : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                // 一动输入就把这条报错撤掉：否则已经修好的字段还挂着无效状态。
                setAddError("");
              }}
            />
          </div>

          <Button type="submit" className="justify-self-start sm:justify-self-auto">
            添加分类
          </Button>
        </form>

        <ErrorText id={ADD_ERROR_ID} message={addError} />

        <ul className="grid gap-1.5">
          {listed.map((category) => {
            const inUse = usedNames.has(category.name);
            const isRenaming = renaming?.id === category.id;
            return (
              <li key={category.id} className="grid gap-1.5">
                <span className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-soft px-3 py-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full ring-1 ring-black/5"
                    style={{ background: category.color }}
                  />
                  <span
                    className={[
                      "text-sm font-medium",
                      category.disabled ? "text-faint line-through" : "",
                    ].join(" ")}
                  >
                    {category.name}
                  </span>
                  {category.builtin && (
                    <Badge variant="outline" className="text-[11px]">
                      内置
                    </Badge>
                  )}
                  {category.disabled && (
                    <Badge variant="secondary" className="text-[11px]">
                      已停用
                    </Badge>
                  )}
                  {!category.builtin && inUse && (
                    <span className="text-[11px] text-faint">已有账单使用，无法删除</span>
                  )}

                  <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
                    {isRenaming ? (
                      <>
                        <Input
                          aria-label={`编辑 ${category.name}`}
                          className="h-8 w-32 sm:w-44"
                          autoComplete="off"
                          value={renaming.value}
                          aria-invalid={renameError ? true : undefined}
                          aria-describedby={renameError ? RENAME_ERROR_ID : undefined}
                          onChange={(event) => {
                            const value = event.target.value;
                            // 用函数式更新留住 original，否则比对基准一丢就把「没改动」报成改名。
                            setRenaming((current) => (current ? { ...current, value } : current));
                            setRenameError("");
                          }}
                        />
                        <Button type="button" size="sm" onClick={commitRename}>
                          保存重命名
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={cancelRename}>
                          取消
                        </Button>
                      </>
                    ) : (
                      <>
                        {!category.builtin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`重命名 ${category.name}`}
                            onClick={() => startRename(category)}
                          >
                            <PencilIcon aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${category.disabled ? "启用" : "停用"} ${category.name}`}
                          onClick={() => toggle(category)}
                          className={category.disabled ? "text-positive" : ""}
                        >
                          {category.disabled ? (
                            <PowerIcon aria-hidden="true" />
                          ) : (
                            <PowerOffIcon aria-hidden="true" />
                          )}
                        </Button>
                        {!category.builtin && !inUse && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`删除 ${category.name}`}
                            onClick={() => remove(category)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-negative"
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        )}
                      </>
                    )}
                  </span>
                </span>
                {isRenaming && <ErrorText id={RENAME_ERROR_ID} message={renameError} />}
              </li>
            );
          })}
        </ul>

        <ErrorText id={ACTION_ERROR_ID} message={actionError} />

        <p className="text-[11px] text-faint">
          当前为{TYPE_LABEL[type]}分类，共 {listed.length} 个，其中{" "}
          {listed.filter((category) => !category.disabled).length} 个可用。
        </p>
      </CardContent>
    </Card>
  );
}

/** 报错只描述它所属的那一步：role="alert" 让屏幕阅读器立刻念出来，id 给对应控件引用。 */
function ErrorText({ id, message }: { id: string; message: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-[13px] text-negative">
      <CircleAlertIcon className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
}
