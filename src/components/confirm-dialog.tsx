import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmRequest {
  title: string;
  body: string;
  hint?: string;
  okLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

interface Props {
  request: ConfirmRequest | null;
  onClose: () => void;
}

export function ConfirmDialog({ request, onClose }: Props) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.title ?? ""}</DialogTitle>
          <DialogDescription>{request?.hint ?? "此操作会立即重算本月统计。"}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{request?.body}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant={request?.destructive ? "destructive" : "default"}
            onClick={() => {
              request?.onConfirm();
              onClose();
            }}
          >
            {request?.okLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
