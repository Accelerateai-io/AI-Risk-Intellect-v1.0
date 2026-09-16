import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { positionTableTip } from "../../../utils/positionTableTip";

const WHY_BRIEFS: Record<string, string> = {
  Language: "The source article is not in English, so a reviewer must check the extraction.",
  Duplicate: "This looks like a near-duplicate of an existing risk.",
  Catalog: "The closest catalog match was judged not to describe the same risk.",
  Quality: "Quality score is below 0.90, so it needs a human check.",
  Domain: "The extracted domain is not one of the 7 taxonomy domains.",
  Evidence: "The extraction had no taxonomy evidence (keywords or excerpts).",
  Review: "This item needs a human check before it can go to Risks.",
};

function briefForWhy(label: string, reason?: string): string {
  const stored = reason?.trim();
  if (stored) return stored;
  return WHY_BRIEFS[label] ?? WHY_BRIEFS.Review;
}

export const ReviewWhyPill = memo(function ReviewWhyPill({
  label,
  reason,
}: {
  label?: string;
  reason?: string;
}) {
  const why = label?.trim() || "Review";
  const brief = briefForWhy(why, reason);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(0);
  const panelId = useId();
  const [pos, setPos] = useState({
    top: 0,
    left: 0,
    maxWidth: 288,
    maxHeight: 240,
  });

  const updatePos = useCallback(() => {
    const trigger = wrapRef.current;
    if (!trigger) return;
    setPos(
      positionTableTip({
        trigger,
        panel: panelRef.current,
        estimatedWidth: 288,
      }),
    );
  }, []);

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (pinned) return;
      setOpen(false);
    }, 120);
  }, [cancelClose, pinned]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const frame = window.requestAnimationFrame(updatePos);
    return () => window.cancelAnimationFrame(frame);
  }, [open, brief, updatePos]);

  useEffect(() => {
    if (!open) return;
    const scrollRoot = wrapRef.current?.closest(
      ".riskPage__tableScroll, .jobsPage__tableScroll",
    );
    const onMove = () => updatePos();
    scrollRoot?.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      scrollRoot?.removeEventListener("scroll", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return (
    <div
      ref={wrapRef}
      className="reviewPage__whyTip"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={`reviewPage__pill reviewPage__pill--why reviewPage__pill--why${why}${open ? " reviewPage__pill--whyOpen" : ""}`}
        aria-label={`${why}: ${brief}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setOpen(false);
            return;
          }
          setPinned(true);
          setOpen(true);
        }}
      >
        {why}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="tooltip"
              className="reviewPage__whyTipPanel reviewPage__whyTipPanel--portal"
              style={{
                top: pos.top,
                left: pos.left,
                maxWidth: pos.maxWidth,
                maxHeight: pos.maxHeight,
              }}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              <p className="reviewPage__whyTipTitle">Why it is in review</p>
              <p className="reviewPage__whyTipBody">{brief}</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});
