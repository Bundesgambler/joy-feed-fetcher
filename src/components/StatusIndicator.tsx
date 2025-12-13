import { cn } from "@/lib/utils";

interface StatusIndicatorProps {
  isActive: boolean;
  nextCheck?: Date;
}

export function StatusIndicator({ isActive, nextCheck }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            isActive 
              ? "bg-success animate-pulse-soft" 
              : "bg-muted-foreground"
          )}
        />
        <span className="text-sm font-medium">
          {isActive ? "Aktiv (7:00 - 20:00)" : "Inaktiv"}
        </span>
      </div>
      {nextCheck && isActive && (
        <span className="text-xs text-muted-foreground">
          Nächste Prüfung in 15 Min
        </span>
      )}
    </div>
  );
}
