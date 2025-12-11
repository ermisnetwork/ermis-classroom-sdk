import React, { useRef, useMemo, createContext, useContext, useEffect, useState } from 'react';
import type { FocusLayoutProps, FocusLayoutContainerProps, ParticipantData, ScreenShareData } from './types';

interface FocusLayoutContextValue {
  focusedParticipant: ParticipantData | null;
  sidebarParticipants: ParticipantData[];
  screenShares: ScreenShareData[];
  mainWidth: number;
  mainHeight: number;
  sidebarTileWidth: number;
  sidebarTileHeight: number;
  visibleParticipants: ParticipantData[];
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
  sidebarWidth = 384,
  sidebarTileHeight = 216,
  gap = 8,
  className = '',
  style,
  renderParticipant,
  renderScreenShare,
  ...props
}: FocusLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [mainSize, setMainSize] = useState({ width: 0, height: 0 });
  const [sidebarHeight, setSidebarHeight] = useState(0);

  const focusedParticipant = useMemo(() => {
    if (focusedParticipantId) {
      return participants.find((p) => p.id === focusedParticipantId) || participants[0] || null;
    }
    return participants.find((p) => p.isPinned) || participants[0] || null;
  }, [participants, focusedParticipantId]);

  const sidebarParticipants = useMemo(() => {
    if (!focusedParticipant) return participants;
    return participants.filter((p) => p.id !== focusedParticipant.id);
  }, [participants, focusedParticipant]);

  const maxVisibleTiles = useMemo(() => {
    if (sidebarHeight <= 0) return sidebarParticipants.length + screenShares.length;
    const screenShareCount = screenShares.length;
    const screenSharesHeight = screenShareCount * (sidebarTileHeight + gap);
    const availableHeight = sidebarHeight - screenSharesHeight;
    const overflowIndicatorHeight = 40;
    const maxParticipants = Math.floor((availableHeight - overflowIndicatorHeight) / (sidebarTileHeight + gap));
    return Math.max(0, maxParticipants);
  }, [sidebarHeight, sidebarTileHeight, gap, screenShares.length, sidebarParticipants.length]);

  const { visibleParticipants, overflowCount } = useMemo(() => {
    if (sidebarParticipants.length <= maxVisibleTiles) {
      return { visibleParticipants: sidebarParticipants, overflowCount: 0 };
    }
    const visible = sidebarParticipants.slice(0, maxVisibleTiles);
    const overflow = sidebarParticipants.length - maxVisibleTiles;
    return { visibleParticipants: visible, overflowCount: overflow };
  }, [sidebarParticipants, maxVisibleTiles]);

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
    const updateSidebarHeight = () => {
      if (!sidebarRef.current) return;
      const { height } = sidebarRef.current.getBoundingClientRect();
      setSidebarHeight(height);
    };
    updateSidebarHeight();
    const resizeObserver = new ResizeObserver(updateSidebarHeight);
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
      width: `${sidebarWidth}px`,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: `${gap}px`,
      overflow: 'hidden',
    }),
    [sidebarWidth, gap]
  );

  const overflowIndicatorStyle = useMemo(
    () => ({
      width: '100%',
      height: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#334155',
      borderRadius: '8px',
      color: 'white',
      fontSize: '14px',
      fontWeight: 500,
      flexShrink: 0,
    }),
    []
  );

  const contextValue = useMemo<FocusLayoutContextValue>(
    () => ({
      focusedParticipant,
      sidebarParticipants,
      screenShares,
      mainWidth: mainSize.width,
      mainHeight: mainSize.height,
      sidebarTileWidth: sidebarWidth,
      sidebarTileHeight,
      visibleParticipants,
      overflowCount,
    }),
    [focusedParticipant, sidebarParticipants, screenShares, mainSize, sidebarWidth, sidebarTileHeight, visibleParticipants, overflowCount]
  );

  const mainTileSize = { width: mainSize.width, height: mainSize.height };
  const sidebarTileSize = { width: sidebarWidth, height: sidebarTileHeight };

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
          {focusedParticipant && renderParticipant && renderParticipant(focusedParticipant, mainTileSize)}
        </div>
        <div ref={sidebarRef} className="ermis-focus-layout-sidebar" style={sidebarStyle}>
          {screenShares.map((ss) => renderScreenShare && (
            <React.Fragment key={`screen-${ss.id}`}>
              {renderScreenShare(ss, sidebarTileSize)}
            </React.Fragment>
          ))}
          {visibleParticipants.map((p) => renderParticipant && (
            <React.Fragment key={p.id}>
              {renderParticipant(p, sidebarTileSize)}
            </React.Fragment>
          ))}
          {overflowCount > 0 && (
            <div className="ermis-focus-layout-overflow" style={overflowIndicatorStyle}>
              +{overflowCount} more
            </div>
          )}
        </div>
        {children}
      </div>
    </FocusLayoutContext.Provider>
  );
}

