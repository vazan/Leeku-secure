import { useMemo } from "react";
import { useLoadingProgress } from "@/app/shared/hooks/use-loading-progress";

/**
 * Multicolored progression bar shown at the top of the dashboard content.
 *
 * While any loading operation is in flight it fills from the left edge toward
 * a visible high watermark; once every operation settles it completes to 100%
 * and fades out. The colors run across the fill so the trailing edge always
 * shows the full spectrum, giving a sense of momentum without a spinning icon.
 */
export interface LoadingOperation {
  /** Whether this operation is currently in flight. */
  loading: boolean;
  /** Relative weight of this operation (heavier loads dominate the %). */
  weight?: number;
}

export default function LoadingProgressBar({
  operations,
}: {
  operations: LoadingOperation[];
}) {
  // Stabilize the array identity so the RAF loop does not restart on every
  // dashboard re-render; it only resets when the loading flags actually change.
  const stable = useMemo(
    () => operations.map((op) => ({ loading: op.loading, weight: op.weight ?? 1 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [operations.map((op) => op.loading).join(",")],
  );

  const progress = useLoadingProgress(stable);
  const active = stable.some((op) => op.loading);

  return (
    <div
      aria-hidden="true"
      className={`h-1 overflow-hidden rounded-full bg-[var(--bg-hover)] transition-[opacity] duration-300 ${
        active || progress > 0 ? "mb-5 opacity-100" : "mb-0 opacity-0"
      }`}
    >
      <div
        className="h-full bg-[linear-gradient(90deg,var(--accent-linear),var(--success-linear),var(--warning-linear),var(--error-linear))] transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
