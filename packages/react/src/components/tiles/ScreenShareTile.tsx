import React, { useRef, useEffect, useMemo } from 'react';
import { IconScreenShare } from '@tabler/icons-react';
import type { ScreenShareTileProps } from '../layouts/types';

export function ScreenShareTile({
  screenShare,
  width,
  height,
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
      top: 8,
      left: 8,
      padding: '4px 8px',
      borderRadius: 4,
      backgroundColor: '#2563eb',
      color: 'white',
      fontSize: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    }),
    []
  );

  return (
    <div
      className={`ermis-screen-share-tile ${className}`}
      style={containerStyle}
      data-ermis-screen-share={screenShare.id}
      {...props}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={videoStyle}
      />
      <div style={labelStyle}>
        <IconScreenShare size={16} />
        {screenShare.userName}'s screen
      </div>
    </div>
  );
}

