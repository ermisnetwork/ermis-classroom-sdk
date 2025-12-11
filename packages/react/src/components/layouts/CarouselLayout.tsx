import React, { useRef, useMemo, useState, useLayoutEffect, createContext, useContext } from 'react';
import type { CarouselLayoutProps, ParticipantData, ScreenShareData } from './types';
import { useSize } from '../../hooks/useSize';

const MIN_HEIGHT = 130;
const MIN_WIDTH = 140;
const ASPECT_RATIO = 16 / 10;
const ASPECT_RATIO_INVERT = (1 - ASPECT_RATIO) * -1;

interface CarouselLayoutContextValue {
  orientation: 'horizontal' | 'vertical';
  tileWidth: number;
  tileHeight: number;
  maxVisibleTiles: number;
}

const CarouselLayoutContext = createContext<CarouselLayoutContextValue | null>(null);

export function useCarouselLayoutContext() {
  const context = useContext(CarouselLayoutContext);
  if (!context) {
    throw new Error('useCarouselLayoutContext must be used within a CarouselLayout');
  }
  return context;
}

export function CarouselLayout({
  participants,
  screenShares = [],
  children,
  orientation: propOrientation,
  tileWidth: propTileWidth,
  tileHeight: propTileHeight,
  gap = 8,
  maxVisibleTiles: propMaxVisible,
  className = '',
  style,
  renderParticipant,
  renderScreenShare,
  onParticipantClick,
  ...props
}: CarouselLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [prevTiles, setPrevTiles] = useState(0);
  const { width, height } = useSize(containerRef);

  const orientation = propOrientation || (height >= width ? 'vertical' : 'horizontal');

  const tileSpan = orientation === 'vertical'
    ? Math.max(width * ASPECT_RATIO_INVERT, MIN_HEIGHT)
    : Math.max(height * ASPECT_RATIO, MIN_WIDTH);

  const tilesThatFit = orientation === 'vertical'
    ? Math.max(height / tileSpan, 1)
    : Math.max(width / tileSpan, 1);

  let maxVisibleTiles = propMaxVisible || Math.round(tilesThatFit);
  if (Math.abs(tilesThatFit - prevTiles) < 0.5) {
    maxVisibleTiles = Math.round(prevTiles);
  } else if (prevTiles !== tilesThatFit) {
    setPrevTiles(tilesThatFit);
  }

  const tileWidth = propTileWidth || (orientation === 'vertical' ? width - gap * 2 : Math.floor(tileSpan));
  const tileHeight = propTileHeight || (orientation === 'vertical' ? Math.floor(tileSpan) : height - gap * 2);

  const allItems = useMemo(() => {
    const items: Array<{ type: 'participant' | 'screen'; data: ParticipantData | ScreenShareData }> = [];
    screenShares.forEach((ss) => items.push({ type: 'screen', data: ss }));
    participants.forEach((p) => items.push({ type: 'participant', data: p }));
    return items;
  }, [participants, screenShares]);

  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.dataset.ermisOrientation = orientation;
      containerRef.current.style.setProperty('--ermis-max-visible-tiles', maxVisibleTiles.toString());
    }
  }, [maxVisibleTiles, orientation]);

  const contextValue = useMemo<CarouselLayoutContextValue>(
    () => ({ orientation, tileWidth, tileHeight, maxVisibleTiles }),
    [orientation, tileWidth, tileHeight, maxVisibleTiles]
  );

  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      flexDirection: orientation === 'vertical' ? 'column' as const : 'row' as const,
      gap: `${gap}px`,
      overflow: 'auto',
      ...style,
    }),
    [orientation, gap, style]
  );

  const tileSize = { width: tileWidth, height: tileHeight };

  return (
    <CarouselLayoutContext.Provider value={contextValue}>
      <aside
        ref={containerRef}
        className={`ermis-carousel-layout ${className}`}
        style={containerStyle}
        data-ermis-layout="carousel"
        {...props}
      >
        {allItems.map((item) => {
          if (item.type === 'screen') {
            const ss = item.data as ScreenShareData;
            return renderScreenShare ? (
              <React.Fragment key={`screen-${ss.id}`}>
                {renderScreenShare(ss, tileSize)}
              </React.Fragment>
            ) : null;
          }
          const p = item.data as ParticipantData;
          return renderParticipant ? (
            <React.Fragment key={p.id}>
              {renderParticipant(p, tileSize)}
            </React.Fragment>
          ) : null;
        })}
        {children}
      </aside>
    </CarouselLayoutContext.Provider>
  );
}

