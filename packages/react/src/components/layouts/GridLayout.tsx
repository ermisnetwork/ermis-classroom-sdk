import React, { useRef, useMemo, createContext, useContext, ReactNode } from 'react';
import type { GridLayoutProps, ParticipantData, ScreenShareData, GridLayoutInfo } from './types';
import { useGridLayout } from '../../hooks/useGridLayout';
import { usePagination } from '../../hooks/usePagination';

interface GridLayoutContextValue {
  layout: GridLayoutInfo;
  participants: ParticipantData[];
  screenShares: ScreenShareData[];
  tileWidth: number;
  tileHeight: number;
  currentPage: number;
  totalPages: number;
  nextPage: () => void;
  prevPage: () => void;
}

const GridLayoutContext = createContext<GridLayoutContextValue | null>(null);

export function useGridLayoutContext() {
  const context = useContext(GridLayoutContext);
  if (!context) {
    throw new Error('useGridLayoutContext must be used within a GridLayout');
  }
  return context;
}

export function GridLayout({
  participants,
  screenShares = [],
  children,
  gap = 8,
  className = '',
  style,
  renderParticipant,
  renderScreenShare,
  onParticipantClick,
  ...props
}: GridLayoutProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  const allItems = useMemo(() => {
    const items: Array<{ type: 'participant' | 'screen'; data: ParticipantData | ScreenShareData }> = [];
    screenShares.forEach((ss) => items.push({ type: 'screen', data: ss }));
    participants.forEach((p) => items.push({ type: 'participant', data: p }));
    return items;
  }, [participants, screenShares]);

  const { layout, containerWidth, containerHeight } = useGridLayout(gridRef, allItems.length, { gap });

  const pagination = usePagination(allItems, layout.maxTiles);

  const contextValue = useMemo<GridLayoutContextValue>(
    () => ({
      layout,
      participants,
      screenShares,
      tileWidth: layout.tileWidth,
      tileHeight: layout.tileHeight,
      currentPage: pagination.currentPage,
      totalPages: pagination.totalPages,
      nextPage: pagination.nextPage,
      prevPage: pagination.prevPage,
    }),
    [layout, participants, screenShares, pagination]
  );

  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      flexWrap: 'wrap' as const,
      justifyContent: 'center',
      alignItems: 'center',
      alignContent: 'center',
      gap: `${gap}px`,
      width: '100%',
      height: '100%',
      ...style,
    }),
    [gap, style]
  );

  const tileSize = { width: layout.tileWidth, height: layout.tileHeight };

  return (
    <GridLayoutContext.Provider value={contextValue}>
      <div
        ref={gridRef}
        className={`ermis-grid-layout ${className}`}
        style={containerStyle}
        data-ermis-layout="grid"
        data-ermis-pagination={pagination.totalPages > 1}
        {...props}
      >
        {pagination.items.map((item, index) => {
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
        {pagination.totalPages > 1 && (
          <div className="ermis-pagination-indicator" style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>
            <span>{pagination.currentPage} / {pagination.totalPages}</span>
          </div>
        )}
      </div>
    </GridLayoutContext.Provider>
  );
}

