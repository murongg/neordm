import type { ReactNode } from "react";

type TooltipSide = "top" | "bottom" | "left" | "right";

const TOOLTIP_SIDE_CLASSES: Record<TooltipSide, string> = {
  top: "tooltip-top",
  bottom: "tooltip-bottom",
  left: "tooltip-left",
  right: "tooltip-right",
};

interface TooltipProps {
  content?: string;
  children: ReactNode;
  className?: string;
  side?: TooltipSide;
}

export function Tooltip({
  content,
  children,
  className = "inline-flex",
  side = "top",
}: TooltipProps) {
  if (!content) {
    return <>{children}</>;
  }

  return (
    <span
      className={`tooltip ${TOOLTIP_SIDE_CLASSES[side]} ${className} before:z-[120] after:z-[120] before:max-w-[20rem] before:whitespace-normal before:break-words before:rounded-lg before:border before:border-base-content/10 before:bg-base-100 before:px-2.5 before:py-1.5 before:text-[11px] before:font-mono before:leading-snug before:text-base-content before:shadow-lg`}
      data-tip={content}
    >
      {children}
    </span>
  );
}
