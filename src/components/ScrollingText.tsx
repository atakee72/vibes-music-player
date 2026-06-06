import { useEffect, useRef, useState } from 'react';

interface ScrollingTextProps {
  text: string;
  className?: string;
}

/**
 * Renders text that auto-scrolls (marquee) **only when it overflows** its
 * container — so long song titles aren't cut off on narrow screens, while short
 * ones render normally (and keep the parent's text alignment). The marquee is
 * `motion-safe`, so it's static under `prefers-reduced-motion`.
 */
export function ScrollingText({ text, className }: ScrollingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    // Measure the block inner (not an inline span — inline `scrollWidth` equals
    // `clientWidth`, and `truncate` would too, both hiding real overflow).
    const check = () => setOverflows(inner.scrollWidth > container.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div ref={containerRef} className={`overflow-hidden ${className ?? ''}`}>
      <div
        ref={innerRef}
        className={`whitespace-nowrap ${
          overflows ? 'inline-flex w-max motion-safe:animate-marquee' : ''
        }`}
      >
        <span className={overflows ? 'pr-8' : undefined}>{text}</span>
        {overflows && (
          <span className="pr-8" aria-hidden="true">
            {text}
          </span>
        )}
      </div>
    </div>
  );
}
