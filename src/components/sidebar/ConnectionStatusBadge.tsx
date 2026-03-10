import { useEffect, useRef, useState, type MouseEvent } from "react";
import { AlertCircle, Loader, Wifi, WifiOff } from "lucide-react";
import type { RedisConnection } from "../../types";
import { STATUS_TRANSITION_MS } from "./constants";

const STATUS_ICONS = {
  connected: <Wifi size={10} className="text-success" />,
  disconnected: <WifiOff size={10} className="text-base-content/30" />,
  connecting: <Loader size={10} className="text-warning animate-spin" />,
  error: <AlertCircle size={10} className="text-error" />,
};

const STATUS_BADGE_CLASSES: Record<RedisConnection["status"], string> = {
  connected: "bg-success/12 shadow-[0_0_0_1px_rgba(34,197,94,0.12)]",
  disconnected: "bg-base-200/90 shadow-[0_0_0_1px_rgba(148,163,184,0.08)]",
  connecting: "bg-warning/12 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]",
  error: "bg-error/12 shadow-[0_0_0_1px_rgba(239,68,68,0.12)]",
};

interface ConnectionStatusBadgeProps {
  status: RedisConnection["status"];
  onDisconnect?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  disconnectLabel?: string;
  onShowTooltip?: (target: HTMLElement, content: string) => void;
  onHideTooltip?: () => void;
  placement?: "overlay" | "inline" | "row-end";
}

export function ConnectionStatusBadge({
  status,
  onDisconnect,
  onContextMenu,
  disconnectLabel,
  onShowTooltip,
  onHideTooltip,
  placement = "overlay",
}: ConnectionStatusBadgeProps) {
  const [displayStatus, setDisplayStatus] = useState(status);
  const [isVisible, setIsVisible] = useState(true);
  const statusEnterFrameRef = useRef<number | null>(null);
  const statusSwapTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === displayStatus) {
      return;
    }

    if (statusEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(statusEnterFrameRef.current);
      statusEnterFrameRef.current = null;
    }

    if (statusSwapTimerRef.current !== null) {
      window.clearTimeout(statusSwapTimerRef.current);
      statusSwapTimerRef.current = null;
    }

    setIsVisible(false);
    statusSwapTimerRef.current = window.setTimeout(() => {
      statusSwapTimerRef.current = null;
      setDisplayStatus(status);
      statusEnterFrameRef.current = window.requestAnimationFrame(() => {
        statusEnterFrameRef.current = null;
        setIsVisible(true);
      });
    }, STATUS_TRANSITION_MS / 2);
  }, [displayStatus, status]);

  useEffect(() => {
    return () => {
      if (statusEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(statusEnterFrameRef.current);
      }

      if (statusSwapTimerRef.current !== null) {
        window.clearTimeout(statusSwapTimerRef.current);
      }
    };
  }, []);

  const placementClassName =
    placement === "inline"
      ? "relative shrink-0"
      : placement === "row-end"
        ? "absolute right-3 top-1/2 -translate-y-1/2"
        : "absolute -bottom-0.5 -right-0.5";
  const badgeClassName = `${placementClassName} grid h-3.5 w-3.5 place-items-center rounded-full ring-1 ring-base-300/90 backdrop-blur-sm transition-[opacity,transform,background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none ${
    STATUS_BADGE_CLASSES[displayStatus]
  } ${isVisible ? "scale-100 opacity-100" : "scale-75 opacity-0"}`;

  if (displayStatus === "connected" && onDisconnect) {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        onContextMenu={onContextMenu}
        onMouseEnter={(event) => {
          if (disconnectLabel) {
            onShowTooltip?.(event.currentTarget, disconnectLabel);
          }
        }}
        onMouseLeave={onHideTooltip}
        onFocus={(event) => {
          if (disconnectLabel) {
            onShowTooltip?.(event.currentTarget, disconnectLabel);
          }
        }}
        onBlur={onHideTooltip}
        className={`${badgeClassName} cursor-pointer hover:scale-105 hover:bg-success/18 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-success`}
        aria-label={disconnectLabel}
      >
        {STATUS_ICONS[displayStatus]}
      </button>
    );
  }

  return <span className={badgeClassName}>{STATUS_ICONS[displayStatus]}</span>;
}
