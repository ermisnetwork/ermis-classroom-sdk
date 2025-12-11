import React, { useRef, useMemo, createContext, useContext, useEffect, useState } from 'react';
import type { FocusLayoutProps, FocusLayoutContainerProps, ParticipantData, ScreenShareData } from './types';

export type FocusTileItem =
  | { type: 'participant'; data: ParticipantData }
  | { type: 'screenShare'; data: ScreenShareData };

interface FocusLayoutContextValue {
  focusedTile: FocusTileItem | null;
  sidebarTiles: FocusTileItem[];
  mainWidth: number;
  mainHeight: number;
  sidebarTileWidth: number;
  sidebarTileHeight: number;
  visibleTiles: FocusTileItem[];
  overflowCount: number;
}

const FocusLayoutContext = createContext<FocusLayoutContextValue | null>(null);

export function useFocusLayoutContext() {
  const context = useContext(FocusLayoutContext);
  if (!context) {
    throw new Error('useFocusLayoutContext must be used within a FocusLayout');
  }
  return context;
}

export function FocusLayoutContainer({
  children,
  className = '',
  style,
  ...props
}: FocusLayoutContainerProps) {
  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      width: '100%',
      height: '100%',
      gap: '8px',
      ...style,
    }),
    [style]
  );

  return (
    <div
      className={`ermis-focus-layout-container ${className}`}
      style={containerStyle}
      data-ermis-layout="focus-container"
      {...props}
    >
      {children}
    </div>
  );
}

export function FocusLayout({
  participants,
  screenShares = [],
  children,
  focusedParticipantId,
  sidebarWidth: sidebarWidthProp,
  sidebarTileHeight: sidebarTileHeightProp,
  gap = 8,
  className = '',
  style,
  renderParticipant,
  renderScreenShare,
  renderOverflow,
  ...props
}: FocusLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });
  const [sidebarSize, setSidebarSize] = useState({ width: 0, height: 0 });

  const allTiles = useMemo<FocusTileItem[]>(() => {
    const participantTiles: FocusTileItem[] = participants.map((p) => ({ type: 'participant', data: p }));
    const screenShareTiles: FocusTileItem[] = screenShares.map((ss) => ({ type: 'screenShare', data: ss }));
    return [...screenShareTiles, ...participantTiles];
  }, [participants, screenShares]);

  const focusedTile = useMemo<FocusTileItem | null>(() => {
    if (focusedParticipantId) {
      const found = allTiles.find((t) =>
        (t.type === 'participant' && t.data.id === focusedParticipantId) ||
        (t.type === 'screenShare' && t.data.id === focusedParticipantId)
      );
      if (found) return found;
    }
    const pinned = allTiles.find((t) =>
      (t.type === 'participant' && t.data.isPinned) ||
      (t.type === 'screenShare' && t.data.isPinned)
    );
    if (pinned) return pinned;
    return allTiles[0] || null;
  }, [allTiles, focusedParticipantId]);

  const sidebarTiles = useMemo<FocusTileItem[]>(() => {
    if (!focusedTile) return allTiles;
    return allTiles.filter((t) => t.data.id !== focusedTile.data.id);
  }, [allTiles, focusedTile]);

  const sidebarWidth = useMemo(() => {
    if (sidebarWidthProp) return sidebarWidthProp;
    return sidebarSize.width > 0 ? sidebarSize.width : 384;
  }, [sidebarWidthProp, sidebarSize.width]);

  const totalSidebarItems = sidebarTiles.length;

  const { sidebarTileHeight, maxVisibleTiles } = useMemo(() => {
    const containerHeight = sidebarSize.height;
    const containerWidth = sidebarSize.width;
    if (containerHeight <= 0 || containerWidth <= 0) {
      return {
        sidebarTileHeight: sidebarTileHeightProp ?? 216,
        maxVisibleTiles: totalSidebarItems
      };
    }
    if (sidebarTileHeightProp) {
      const maxTiles = Math.floor(containerHeight / (sidebarTileHeightProp + gap));
      return { sidebarTileHeight: sidebarTileHeightProp, maxVisibleTiles: Math.max(1, maxTiles) };
    }
    const aspectRatio = 16 / 9;
    const maxHeightByAspect = Math.floor(containerWidth / aspectRatio);
    const minTileHeight = 80;
    const maxTileHeight = Math.min(maxHeightByAspect, 300);
    let bestTileHeight = maxTileHeight;
    let bestVisibleCount = Math.floor(containerHeight / (maxTileHeight + gap));
    if (bestVisibleCount < totalSidebarItems) {
      const neededTiles = Math.min(totalSidebarItems, 6);
      const calculatedHeight = Math.floor((containerHeight - (neededTiles - 1) * gap) / neededTiles);
      bestTileHeight = Math.max(minTileHeight, Math.min(calculatedHeight, maxTileHeight));
      bestVisibleCount = Math.floor(containerHeight / (bestTileHeight + gap));
    }
    return {
      sidebarTileHeight: bestTileHeight,
      maxVisibleTiles: Math.max(1, bestVisibleCount)
    };
  }, [sidebarSize.height, sidebarSize.width, sidebarTileHeightProp, gap, totalSidebarItems]);

  const { visibleTiles, overflowCount } = useMemo(() => {
    if (sidebarTiles.length <= maxVisibleTiles) {
      return { visibleTiles: sidebarTiles, overflowCount: 0 };
    }
    const visible = sidebarTiles.slice(0, Math.max(0, maxVisibleTiles - 1));
    const overflow = sidebarTiles.length - visible.length;
    return { visibleTiles: visible, overflowCount: overflow };
  }, [sidebarTiles, maxVisibleTiles]);

  useEffect(() => {
    if (!mainRef.current) return;
    const updateSize = () => {
      if (!mainRef.current) return;
      const { width, height } = mainRef.current.getBoundingClientRect();
      const aspectRatio = 16 / 9;
      let tileWidth = width;
      let tileHeight = tileWidth / aspectRatio;
      if (tileHeight > height) {
        tileHeight = height;
        tileWidth = tileHeight * aspectRatio;
      }
      setMainSize({ width: Math.floor(tileWidth), height: Math.floor(tileHeight) });
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(mainRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!sidebarRef.current) return;
    const updateSidebarSize = () => {
      if (!sidebarRef.current) return;
      const { width, height } = sidebarRef.current.getBoundingClientRect();
      setSidebarSize({ width, height });
    };
    updateSidebarSize();
    const resizeObserver = new ResizeObserver(updateSidebarSize);
    resizeObserver.observe(sidebarRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const containerStyle = useMemo(
    () => ({
      display: 'flex',
      width: '100%',
      height: '100%',
      gap: `${gap}px`,
      ...style,
    }),
    [gap, style]
  );

  const mainAreaStyle = useMemo(
    () => ({
      flex: 1,
      minWidth: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }),
    []
  );

  const sidebarStyle = useMemo(
    () => ({
      width: sidebarWidthProp ? `${sidebarWidthProp}px` : 'clamp(200px, 25%, 400px)',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      justifyContent: 'center',
      gap: `${gap}px`,
      overflow: 'hidden',
    }),
    [sidebarWidthProp, gap]
  );

  const overflowTileStyle = useMemo(
    () => ({
      width: '100%',
      height: `${sidebarTileHeight}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#334155',
      borderRadius: '8px',
      color: 'white',
      fontSize: '18px',
      fontWeight: 600,
      flexShrink: 0,
    }),
    [sidebarTileHeight]
  );

  const contextValue = useMemo<FocusLayoutContextValue>(
    () => ({
      focusedTile,
      sidebarTiles,
      mainWidth: mainSize.width,
      mainHeight: mainSize.height,
      sidebarTileWidth: sidebarWidth,
      sidebarTileHeight,
      visibleTiles,
      overflowCount,
    }),
    [focusedTile, sidebarTiles, mainSize, sidebarWidth, sidebarTileHeight, visibleTiles, overflowCount]
  );

  const mainTileSize = { width: mainSize.width, height: mainSize.height };
  const sidebarTileSize = { width: sidebarWidth, height: sidebarTileHeight };

  const renderTile = (tile: FocusTileItem, size: { width: number; height: number }) => {
    if (tile.type === 'participant' && renderParticipant) {
      return renderParticipant(tile.data, size);
    }
    if (tile.type === 'screenShare' && renderScreenShare) {
      return renderScreenShare(tile.data, size);
    }
    return null;
  };

  return (
    <FocusLayoutContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={`ermis-focus-layout ${className}`}
        style={containerStyle}
        data-ermis-layout="focus"
        {...props}
      >
        <div ref={mainRef} className="ermis-focus-layout-main" style={mainAreaStyle}>
          {focusedTile && renderTile(focusedTile, mainTileSize)}
        </div>
        <div ref={sidebarRef} className="ermis-focus-layout-sidebar" style={sidebarStyle}>
          {visibleTiles.map((tile) => (
            <React.Fragment key={tile.data.id}>
              {renderTile(tile, sidebarTileSize)}
            </React.Fragment>
          ))}
          {overflowCount > 0 && (
            renderOverflow ? (
              renderOverflow(overflowCount, sidebarTileSize)
            ) : (
              <div className="ermis-focus-layout-overflow" style={overflowTileStyle}>
                +{overflowCount} more
              </div>
            )
          )}
        </div>
        {children}
      </div>
    </FocusLayoutContext.Provider>
  );
}

