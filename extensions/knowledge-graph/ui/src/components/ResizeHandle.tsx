import { useCallback, useEffect, useRef } from "react";

interface Props {
  /** Which side of the panel the handle sits on */
  side: "left" | "right";
  /** Current width of the panel being resized */
  width: number;
  /** Callback when width changes */
  onResize: (width: number) => void;
  /** Minimum width in px */
  minWidth?: number;
  /** Maximum width in px */
  maxWidth?: number;
}

export function ResizeHandle({
  side,
  width,
  onResize,
  minWidth = 120,
  maxWidth = 600,
}: Props) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      // For a handle on the right side of a left panel, dragging right increases width
      // For a handle on the left side of a right panel, dragging left increases width
      const newWidth =
        side === "right"
          ? startWidth.current + delta
          : startWidth.current - delta;
      onResize(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [side, onResize, minWidth, maxWidth]);

  return (
    <div
      className={`resize-handle resize-handle-${side}`}
      onMouseDown={onMouseDown}
    />
  );
}
