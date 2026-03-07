import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Check, Info } from "lucide-react";

type ToastTone = "success" | "error" | "info";

interface ToastOptions {
  message: string;
  tone?: ToastTone;
  duration?: number;
}

interface ToastRecord {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

interface ToastContextValue {
  activeToast: ToastRecord | null;
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success/15 text-success",
  error: "border-error/15 text-error",
  info: "border-info/15 text-info",
};

const TOAST_TONE_ICONS = {
  success: Check,
  error: AlertCircle,
  info: Info,
} satisfies Record<ToastTone, typeof Check>;

export function ToastProvider({ children }: { children: ReactNode }) {
  const nextToastIdRef = useRef(0);
  const [activeToast, setActiveToast] = useState<ToastRecord | null>(null);

  const showToast = useCallback((options: ToastOptions) => {
    nextToastIdRef.current += 1;

    setActiveToast({
      id: nextToastIdRef.current,
      message: options.message,
      tone: options.tone ?? "success",
      duration: options.duration ?? 1100,
    });
  }, []);

  const value = useMemo(
    () => ({
      activeToast,
      showToast,
    }),
    [activeToast, showToast]
  );

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

export function ToastViewport({
  className = "fixed left-1/2 top-3 z-[70] -translate-x-1/2",
}: {
  className?: string;
}) {
  const context = useContext(ToastContext);
  const [renderedToast, setRenderedToast] = useState<ToastRecord | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  if (!context) {
    throw new Error("ToastViewport must be used within ToastProvider");
  }

  const { activeToast } = context;

  useEffect(() => {
    if (!activeToast) {
      return;
    }

    setRenderedToast(activeToast);
    setIsVisible(false);

    const enterFrame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    const hideTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, activeToast.duration);

    const clearTimer = window.setTimeout(() => {
      setRenderedToast((previous) =>
        previous?.id === activeToast.id ? null : previous
      );
    }, activeToast.duration + 160);

    return () => {
      window.cancelAnimationFrame(enterFrame);
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [activeToast]);

  if (!renderedToast) {
    return null;
  }

  const ToastIcon = TOAST_TONE_ICONS[renderedToast.tone];

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={`pointer-events-none z-30 ${className}`}
    >
      <div
        className={`flex items-center gap-1.5 rounded-lg border bg-base-100/95 px-3 py-2 text-[11px] font-mono shadow-lg backdrop-blur-sm transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
          TOAST_TONE_STYLES[renderedToast.tone]
        } ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "-translate-y-1 scale-[0.98] opacity-0"
        }`}
      >
        <ToastIcon size={11} />
        <span>{renderedToast.message}</span>
      </div>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return {
    showToast: context.showToast,
  };
}
