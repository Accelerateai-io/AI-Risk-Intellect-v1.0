export interface TableTipPosition {
  top: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
}

const TABLE_SCROLL_SELECTOR =
  ".riskPage__tableScroll, .jobsPage__tableScroll";

function clipRectFor(trigger: HTMLElement): DOMRect {
  const scrollEl = trigger.closest(TABLE_SCROLL_SELECTOR);
  if (scrollEl) return scrollEl.getBoundingClientRect();
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/** Place a portaled tip inside the table (or viewport), never past its edges. */
export function positionTableTip(options: {
  trigger: HTMLElement;
  panel: HTMLElement | null;
  estimatedWidth: number;
  gap?: number;
  pad?: number;
}): TableTipPosition {
  const gap = options.gap ?? 6;
  const pad = options.pad ?? 8;
  const trigger = options.trigger.getBoundingClientRect();
  const bounds = clipRectFor(options.trigger);

  const clipLeft = Math.max(pad, bounds.left + pad);
  const clipTop = Math.max(pad, bounds.top + pad);
  const clipRight = Math.min(window.innerWidth - pad, bounds.right - pad);
  const clipBottom = Math.min(window.innerHeight - pad, bounds.bottom - pad);
  const maxWidth = Math.max(0, clipRight - clipLeft);

  const measuredWidth = options.panel?.offsetWidth || options.estimatedWidth;
  const width = Math.min(options.estimatedWidth, measuredWidth, maxWidth);

  let left = trigger.left + trigger.width / 2 - width / 2;
  if (left + width > clipRight) left = clipRight - width;
  if (left < clipLeft) left = clipLeft;

  const measuredHeight = options.panel?.offsetHeight || 0;
  const spaceBelow = clipBottom - (trigger.bottom + gap);
  const spaceAbove = trigger.top - gap - clipTop;
  const placeBelow =
    measuredHeight === 0
      ? spaceBelow >= spaceAbove
      : spaceBelow >= Math.min(measuredHeight, 72) || spaceBelow >= spaceAbove;

  let top = placeBelow ? trigger.bottom + gap : trigger.top - gap - (measuredHeight || 0);
  if (top < clipTop) top = clipTop;

  const maxHeight = Math.max(
    72,
    placeBelow ? clipBottom - top : trigger.top - gap - clipTop,
  );
  if (!placeBelow && measuredHeight > 0) {
    top = Math.max(clipTop, trigger.top - gap - Math.min(measuredHeight, maxHeight));
  }

  return { top, left, maxWidth, maxHeight };
}
