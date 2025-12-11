import { useState, useLayoutEffect, useCallback, useRef, RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

export function useSize(target: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (target.current) {
      const { width, height } = target.current.getBoundingClientRect();
      setSize({ width, height });
    }
  }, [target]);

  const resizeCallback = useCallback((entry: ResizeObserverEntry) => {
    setSize({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    });
  }, []);

  useResizeObserver(target, resizeCallback);

  return size;
}

type ResizeObserverCallback = (entry: ResizeObserverEntry, observer: ResizeObserver) => void;

function useResizeObserver<T extends HTMLElement>(
  target: RefObject<T | null>,
  callback: ResizeObserverCallback
) {
  const storedCallback = useRef(callback);

  useLayoutEffect(() => {
    storedCallback.current = callback;
  });

  useLayoutEffect(() => {
    const targetEl = target.current;
    if (!targetEl) return;

    const observer = new ResizeObserver((entries, obs) => {
      for (const entry of entries) {
        storedCallback.current(entry, obs);
      }
    });

    observer.observe(targetEl);

    return () => {
      observer.disconnect();
    };
  }, [target]);
}

