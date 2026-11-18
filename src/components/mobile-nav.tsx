import { PieChartIcon, PlusIcon, ReceiptTextIcon, SettingsIcon, WalletIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SectionId } from "@/src/hooks/use-active-section";

const ITEMS: Array<{ id: SectionId; label: string; icon: typeof WalletIcon }> = [
  { id: "overview", label: "概览", icon: WalletIcon },
  { id: "bills", label: "账单", icon: ReceiptTextIcon },
  { id: "budget", label: "预算", icon: PieChartIcon },
  { id: "settings", label: "设置", icon: SettingsIcon },
];

interface Props {
  active: SectionId;
  onNavigate: (id: SectionId) => void;
  onAdd: () => void;
}

export function MobileNav({ active, onNavigate, onAdd }: Props) {
  return (
    <nav
      aria-label="移动端导航"
      className="sticky bottom-0 z-30 grid grid-cols-5 items-center gap-1 border-t border-border bg-card px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] lg:hidden"
    >
      {ITEMS.slice(0, 2).map(({ id, label, icon: Icon }) => (
        <NavLink key={id} id={id} label={label} active={active} onNavigate={onNavigate} icon={Icon} />
      ))}

      <button
        type="button"
        aria-label="记一笔"
        onClick={onAdd}
        className="mx-auto -mt-4 grid size-11 place-items-center rounded-full border-[3px] border-card bg-primary text-primary-foreground shadow-md"
      >
        <PlusIcon className="size-5" aria-hidden="true" />
      </button>

      {ITEMS.slice(2).map(({ id, label, icon: Icon }) => (
        <NavLink key={id} id={id} label={label} active={active} onNavigate={onNavigate} icon={Icon} />
      ))}
    </nav>
  );
}

function NavLink({
  id,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  id: SectionId;
  label: string;
  icon: typeof WalletIcon;
  active: SectionId;
  onNavigate: (id: SectionId) => void;
}) {
  return (
    <a
      href={`#${id}`}
      aria-current={active === id ? "page" : undefined}
      onClick={() => onNavigate(id)}
      className={cn(
        "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[11px] text-faint transition-colors",
        active === id && "font-medium text-primary",
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {label}
    </a>
  );
}
