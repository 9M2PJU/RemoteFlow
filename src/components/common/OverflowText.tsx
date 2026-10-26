import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';

/** Scrolls only the text that exceeds the available line width. */
export function OverflowText({ text, className = '' }: { text: string; className?: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useLayoutEffect(() => {
    const container = viewport.current;
    const content = track.current;
    if (!container || !content) return;
    const measure = () => setDistance(Math.max(0, Math.ceil(content.scrollWidth - container.clientWidth)));
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [text]);

  const style = {
    '--text-pan-distance': `${-distance}px`,
    '--text-pan-duration': `${Math.max(6, distance / 24 + 3)}s`,
  } as CSSProperties;

  return <span ref={viewport} title={text} className={`session-overflow-text block min-w-0 overflow-hidden ${className}`}>
    <span key={text} ref={track} data-overflow={distance > 1 ? 'true' : undefined} style={style}
      className="session-overflow-track inline-block min-w-full whitespace-nowrap align-top">{text}</span>
  </span>;
}
