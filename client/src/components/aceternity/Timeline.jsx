import React, { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

// Aceternity UI's Timeline (ui.aceternity.com), in JavaScript and the app's style: numbered steps
// down the page, each title sticking beside its text while you read, and a line that fills as you
// scroll. items: [{ title, content }]. An ordered list, so screen readers hear the steps in order.

export function Timeline({ items }) {
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const [height, setHeight] = useState(0);

  // The line is as tall as the list; measured again when the list resizes (fonts, a narrower window).
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({ target: containerRef, offset: ['start 15%', 'end 55%'] });
  const lineHeight = useTransform(scrollYProgress, [0, 1], [0, height]);
  const lineOpacity = useTransform(scrollYProgress, [0, 0.08], [0, 1]);

  return (
    <div ref={containerRef} className="relative">
      <ol ref={listRef} className="relative">
        {items.map((item, i) => (
          <li key={item.title} className="flex justify-start gap-4 pt-8 md:gap-10 md:pt-14 first:pt-2">
            <div className="sticky top-24 z-10 flex max-w-xs shrink-0 flex-col items-center self-start md:w-full md:flex-row lg:max-w-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#1a1a1a] bg-[#f5f0e8] text-xs font-black shadow-[2px_2px_0_#1a1a1a]">
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="hidden text-lg font-black tracking-tight md:block md:pl-5 lg:text-2xl">{item.title}</h3>
            </div>
            <div className="relative w-full min-w-0 pr-1">
              <h3 className="mb-2 block text-base font-black tracking-tight md:hidden">{item.title}</h3>
              {item.content}
            </div>
          </li>
        ))}
      </ol>
      <div
        aria-hidden="true"
        style={{ height }}
        className="pointer-events-none absolute left-[19px] top-0 w-[3px] overflow-hidden rounded-full bg-[#1a1a1a]/12 [mask-image:linear-gradient(to_bottom,transparent_0%,black_8%,black_92%,transparent_100%)]"
      >
        <motion.div
          style={{ height: lineHeight, opacity: lineOpacity }}
          className="absolute inset-x-0 top-0 w-[3px] rounded-full bg-linear-to-b from-[#c0392b] via-[#e67e22] to-[#f1c40f]"
        />
      </div>
    </div>
  );
}
