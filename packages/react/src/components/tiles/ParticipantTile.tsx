import React, { useRef, useEffect, useMemo } from 'react';
import { IconPin, IconPinnedOff, IconHandStop, IconMicrophoneOff } from '@tabler/icons-react';
import type { ParticipantTileProps } from '../layouts/types';

export function ParticipantTile({
  participant,
  width,
  height,
  onPin,
  className = '',
  style,
  ...props
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPin?.(participant.id);
  };

  const useFullSize = !width && !height;

  const containerStyle = useMemo(
    () => ({
      position: 'relative' as const,
      overflow: 'hidden',
      borderRadius: '8px',
      backgroundColor: '#1e293b',
      ...(useFullSize ? { width: '100%', height: '100%' } : { width, height }),
      ...style,
    }),
    [width, height, useFullSize, style]
  );

  const videoStyle = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      objectFit: 'cover' as const,
      display: participant.isVideoOff ? 'none' : 'block',
    }),
    [participant.isVideoOff]
  );

  const avatarStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      inset: 0,
      display: participant.isVideoOff ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#334155',
    }),
    [participant.isVideoOff]
  );

  const overlayStyle = useMemo(
    () => ({
      position: 'absolute' as const,
      bottom: 0,
      left: 0,
      right: 0,
      padding: '8px',
      background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
    }),
    []
  );

  return (
    <div
      className={`ermis-participant-tile ${className}`}
      style={containerStyle}
      data-ermis-participant={participant.id}
      data-ermis-pinned={participant.isPinned}
      {...props}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal}
        style={videoStyle}
      />
      <div style={avatarStyle}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          backgroundColor: '#475569',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: 24, fontWeight: 600, color: 'white' }}>
            {participant.name.charAt(0).toUpperCase()}
          </span>
        </div>
      </div>
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
            opacity: participant.isPinned ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
          className="ermis-pin-button"
        >
          {participant.isPinned ? (
            <IconPinnedOff size={16} color="white" />
          ) : (
            <IconPin size={16} color="white" />
          )}
        </button>
      )}
      <div style={overlayStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 500 }}>
            {participant.name} {participant.isLocal && '(You)'}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {participant.isPinned && (
              <span style={{ padding: 4, borderRadius: 4, backgroundColor: '#3b82f6', display: 'flex', alignItems: 'center' }}>
                <IconPin size={12} color="white" />
              </span>
            )}
            {participant.isHandRaised && (
              <span style={{ padding: 4, borderRadius: 4, backgroundColor: '#eab308', display: 'flex', alignItems: 'center' }}>
                <IconHandStop size={12} color="white" />
              </span>
            )}
            {participant.isMuted && (
              <span style={{ padding: 4, borderRadius: 4, backgroundColor: '#ef4444', display: 'flex', alignItems: 'center' }}>
                <IconMicrophoneOff size={12} color="white" />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

