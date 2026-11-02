import { useEffect, useRef, useState } from "react";

/**
 * Tracks several independent loading operations and blends them into a single
 * 0–100 progress value that fills realistically over time.
 *
 * Real byte-level progress is not available for most of the dashboard fetches,
 * so each active operation eases toward a high watermark while it is in
 * flight — giving the bar a believable left-to-right sweep — and snaps to 100%
 * the moment it completes. Operations are weighted so heavier loads (e.g. the
 * file list) dominate the overall number.
 */
export function useLoadingProgress(
  operations: { loading: boolean; weight?: number }[],
): number {
  // Per-operation eased progress, kept in a ref so the RAF loop can mutate it
  // without triggering a state update on every frame. Values persist across
  // renders so an operation that keeps loading does not reset when a sibling
  // operation finishes.
  const easedRef = useRef<number[]>([]);
  // Derived overall percentage (0–100), updated only when it visibly changes.
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Grow the per-op buffer to match the current operation count.
    while (easedRef.current.length < operations.length) {
      easedRef.current.push(0);
    }

    // When nothing is loading, settle the bar back to idle.
    if (operations.every((op) => !op.loading)) {
      setProgress(0);
      return;
    }

    let frame = 0;
    let lastEmitted = -1;
    const tick = () => {
      const totalWeight = operations.reduce(
        (sum, op) => sum + (op.loading ? op.weight ?? 1 : 0),
        0,
      );
      let blended = 0;

      operations.forEach((op, i) => {
        if (!op.loading) {
          // Finished operations contribute their full weight.
          blended += (op.weight ?? 1) * 100;
          return;
        }
        // Ease each active op toward 92% while it is in flight; the final
        // jump to 100% happens when the operation flips to done.
        easedRef.current[i] = Math.min(
          easedRef.current[i] + 0.04 + easedRef.current[i] * 0.08,
          0.92,
        );
        blended += easedRef.current[i] * (op.weight ?? 1) * 100;
      });

      const next = Math.min(100, Math.round(blended / totalWeight));
      if (next !== lastEmitted) {
        lastEmitted = next;
        setProgress(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [operations]);

  return progress;
}
