import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

export const MODAL_TRANSITION_MS = 200;

export function useModalTransition(onClose: () => void) {
  const [isVisible, setIsVisible] = useState(false);
  const onCloseRef = useRef(onClose);
  const enterFrameRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null) return;

    setIsVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, MODAL_TRANSITION_MS);
  }, []);

  useEffect(() => {
    enterFrameRef.current = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      requestClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      if (enterFrameRef.current !== null) {
        window.cancelAnimationFrame(enterFrameRef.current);
        enterFrameRef.current = null;
      }

      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [requestClose]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      requestClose();
    },
    [requestClose]
  );

  return { isVisible, requestClose, handleBackdropClick };
}
