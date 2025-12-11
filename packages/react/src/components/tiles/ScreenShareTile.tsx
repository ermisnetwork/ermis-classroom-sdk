import React, { useRef, useEffect, useMemo } from 'react';
import { IconScreenShare, IconPin, IconPinnedOff } from '@tabler/icons-react';
import type { ScreenShareTileProps } from '../layouts/types';

export function ScreenShareTile({
  screenShare,
  width,
  height,
  onPin,
  className = '',
  style,
  ...props
}: ScreenShareTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && screenShare.stream) {
      videoRef.current.srcObject = screenShare.stream;
    }
  }, [screenShare.stream]);

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPin?.(screenShare.id);
  };

  const useFullSize = !width && !height;

  const containerStyle = useMemo(
    () => ({
      position: 'relative' as const,
      overflow: 'hidden',
      borderRadius: '8px',
      backgroundColor: '#0f172a',
      ...(useFullSize ? { width: '100%', height: '100%' } : { width, height }),
      ...style,
    }),
    [width, height, useFullSize, style]
  );

  const videoStyle = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      objectFit: 'contain' as const,
    }),
    []
  );

  const labelStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      bottom: 0,
      left: 0,
      right: 0,
      padding: '8px',
      background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }),
    []
  );

  const labelTextStyle = useMemo(
    () => ({
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      color: 'white',
      fontSize: 14,
    }),
    []
  );

  return (
    <div
      className={`ermis-screen-share-tile ${className}`}
      style={containerStyle}
      data-ermis-screen-share={screenShare.id}
      data-ermis-pinned={screenShare.isPinned}
      {...props}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={videoStyle}
      />
      {onPin && (
        <button
          onClick={handlePinClick}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: 6,
            borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.5)',
            border: 'none',
            cursor: 'pointer',
            opacity: screenShare.isPinned ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
          className="ermis-pin-button"
        >
          {screenShare.isPinned ? (
            <IconPinnedOff size={16} color="white" />
          ) : (
            <IconPin size={16} color="white" />
          )}
        </button>
      )}
      <div style={labelStyle}>
        <div style={labelTextStyle}>
          <IconScreenShare size={16} />
          {screenShare.userName}'s screen
        </div>
        {screenShare.isPinned && (
          <span style={{ padding: 4, borderRadius: 4, backgroundColor: '#3b82f6', display: 'flex', alignItems: 'center' }}>
            <IconPin size={12} color="white" />
          </span>
        )}
      </div>
    </div>
  );
}

