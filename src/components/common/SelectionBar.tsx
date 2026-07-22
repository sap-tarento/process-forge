import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  selectedCount: number;
  onClear: () => void;
  children?: React.ReactNode;
  label?: string;
}

export function SelectionBar({ selectedCount, onClear, children, label }: Props) {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
      <span className="text-xs font-medium">
        {selectedCount} {label ?? "selected"}
      </span>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClear}>
        <X className="mr-1 h-3 w-3" /> Clear
      </Button>
      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}