import React, { useEffect, useState } from 'react';

/**
 * Stats from the multi-signal congestion control monitor.
 */
interface NetworkStats {
  signal: string;
  rateState: string;
  targetBitrate: number;
  lossFraction: number;
  rttMs: number;
  delayGradient: number;  // Repurposed: backpressure rate (0.0–1.0)
  threshold: number;      // Repurposed: bitrate scale factor
  timestamp: number;
  delayBasedEstimate: number;
  lossBasedEstimate: number;
  incomingBitrate: number;
}

interface ChannelAllocation {
  channelName: string;
  originalBitrate: number;
  originalFps: number;
  currentBitrate: number;
  currentFps: number;
  paused: boolean;
  priority: number;
}

interface AllocationSummary {
  targetBitrate: number;
  allocatedBitrate: number;
  channels: ChannelAllocation[];
}

interface NetworkQualityPanelProps {
  getNetworkQuality: () => { stats: NetworkStats | null; allocation: AllocationSummary | null };
  isOpen: boolean;
  onClose: () => void;
}

// ---- Quality derivation ----

type QualityLevel = 'EXCELLENT' | 'GOOD' | 'POOR' | 'CRITICAL';

function getQualityFromStats(stats: NetworkStats | null): QualityLevel {
  if (!stats) return 'EXCELLENT';

  // Derive from the composite quality (reflects worst-of all signals)
  const bp = stats.delayGradient; // backpressure rate
  const rtt = stats.rttMs;

  // Thresholds aligned with NetworkQualityMonitor.ts
  // RTT: <50ms EXCELLENT, 50-150ms GOOD, 150-300ms POOR, >=300ms CRITICAL
  // BP:  <1% EXCELLENT, 1-5% GOOD, 5-20% POOR, >=20% CRITICAL
  if (bp >= 0.20 || rtt >= 300) return 'CRITICAL';
  if (bp >= 0.05 || rtt >= 150) return 'POOR';
  if (bp >= 0.01 || rtt >= 50) return 'GOOD';
  return 'EXCELLENT';
}

const LEVEL_COLORS: Record<QualityLevel, string> = {
  EXCELLENT: '#22c55e',
  GOOD: '#3b82f6',
  POOR: '#f97316',
  CRITICAL: '#ef4444',
};

const LEVEL_ICONS: Record<QualityLevel, string> = {
  EXCELLENT: '🟢',
  GOOD: '🔵',
  POOR: '🟠',
  CRITICAL: '🔴',
};

const CHANNEL_LABELS: Record<string, string> = {
  mic_48k: '🎤 Mic',
  screen_share_audio: '🔊 Screen Audio',
  livestream_audio: '🔊 Live Audio',
  cam_360p: '📹 Cam 360p',
  cam_720p: '📹 Cam 720p',
  cam_1080p: '📹 Cam 1080p',
  cam_1440p: '📹 Cam 1440p',
  screen_share_720p: '🖥 Screen 720p',
  screen_share_1080p: '🖥 Screen 1080p',
  livestream_720p: '📡 Live 720p',
};

export const NetworkQualityPanel: React.FC<NetworkQualityPanelProps> = ({
  getNetworkQuality,
  isOpen,
  onClose,
}) => {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [allocation, setAllocation] = useState<AllocationSummary | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const update = () => {
      const { stats: s, allocation: a } = getNetworkQuality();
      setStats(s);
      setAllocation(a);
    };

    update();
    const interval = setInterval(update, 500); // 500ms for responsiveness
    return () => clearInterval(interval);
  }, [isOpen, getNetworkQuality]);

  if (!isOpen) return null;

  const rttMs = stats?.rttMs ?? 0;
  const backpressure = stats?.delayGradient ?? 0; // repurposed field
  const bitrateScale = stats?.threshold ?? 1.0;    // repurposed field
  const level = getQualityFromStats(stats);
  const color = LEVEL_COLORS[level];
  const icon = LEVEL_ICONS[level];

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: '14px', fontWeight: 600 }}>
          {icon} Network Quality
        </span>
        <button onClick={onClose} style={closeButtonStyle} title="Close">
          ✕
        </button>
      </div>

      {/* Quality Badge */}
      <div style={{ ...badgeStyle, backgroundColor: color }}>
        {level}
      </div>

      {/* Multi-Signal Stats */}
      <div style={gridStyle}>
        <StatRow
          label="⚡ Backpressure"
          value={`${(backpressure * 100).toFixed(1)}%`}
          textColor={backpressure >= 0.30 ? '#ef4444' : backpressure >= 0.15 ? '#f97316' : backpressure >= 0.05 ? '#3b82f6' : '#22c55e'}
        />
        <StatRow
          label="📡 RTT (P75)"
          value={stats ? `${Math.round(rttMs)} ms` : 'N/A'}
          textColor={rttMs >= 300 ? '#ef4444' : rttMs >= 150 ? '#f97316' : rttMs >= 50 ? '#3b82f6' : '#22c55e'}
        />
        <StatRow
          label="🎯 Target"
          value={stats ? `${Math.round(stats.targetBitrate / 1000)} kbps` : 'N/A'}
        />
        <StatRow
          label="📉 Scale"
          value={`${Math.round(bitrateScale * 100)}%`}
          textColor={bitrateScale < 0.5 ? '#ef4444' : bitrateScale < 1 ? '#eab308' : '#22c55e'}
        />
      </div>

      {/* Threshold Reference */}
      <div style={{ marginTop: '8px' }}>
        <div style={dividerStyle} />
        <div style={{ fontSize: '10px', color: '#64748b', lineHeight: '1.5' }}>
          BP: &lt;1% 🟢 · 1-5% 🔵 · 5-20% 🟠 · &gt;20% 🔴<br/>
          RTT: &lt;50ms 🟢 · 50-150ms 🔵 · 150-300ms 🟠 · &gt;300ms 🔴
        </div>
      </div>

      {/* Channel Allocation */}
      {allocation && allocation.channels.length > 0 && (
        <div style={{ marginTop: '4px' }}>
          <div style={dividerStyle} />
          <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
            📊 Channels
          </div>
          {allocation.channels.map(ch => {
            const label = CHANNEL_LABELS[ch.channelName] ?? ch.channelName.replace(/_/g, ' ');
            const isAudio = ch.priority === 0;
            const bitrateRatio = ch.originalBitrate > 0 ? ch.currentBitrate / ch.originalBitrate : 1;
            const statusColor = ch.paused
              ? '#ef4444'
              : bitrateRatio < 0.5 ? '#f97316'
              : bitrateRatio < 1 ? '#eab308'
              : '#22c55e';

            return (
              <div key={ch.channelName} style={{ marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#e2e8f0', fontWeight: 500 }}>
                    {label}
                  </span>
                  {ch.paused ? (
                    <span style={{ fontSize: '10px', color: '#ef4444', fontWeight: 700 }}>PAUSED</span>
                  ) : (
                    <span style={{ fontSize: '10px', color: statusColor, fontFamily: 'monospace' }}>
                      {Math.round(ch.currentBitrate / 1000)}k · {ch.currentFps}fps
                    </span>
                  )}
                </div>
                {!isAudio && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <div style={barBgStyle}>
                      <div style={{
                        ...barFillStyle,
                        width: `${Math.min(bitrateRatio * 100, 100)}%`,
                        backgroundColor: statusColor,
                      }} />
                    </div>
                    <span style={{ fontSize: '9px', color: '#64748b', minWidth: '28px', textAlign: 'right' }}>
                      {ch.paused ? '0%' : `${Math.round(bitrateRatio * 100)}%`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---- Sub-components ----

const StatRow: React.FC<{
  label: string;
  value: string;
  textColor?: string;
}> = ({ label, value, textColor }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
    <span style={{ color: '#94a3b8' }}>{label}</span>
    <span style={{ color: textColor ?? '#e2e8f0', fontFamily: 'monospace' }}>{value}</span>
  </div>
);

// ---- Styles ----

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '80px',
  right: '16px',
  width: '280px',
  maxHeight: 'calc(100vh - 120px)',
  overflowY: 'auto',
  backgroundColor: 'rgba(15, 23, 42, 0.95)',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.2)',
  padding: '12px',
  color: '#e2e8f0',
  fontFamily: 'Inter, system-ui, sans-serif',
  zIndex: 10000,
  backdropFilter: 'blur(12px)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '10px',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  cursor: 'pointer',
  fontSize: '14px',
  padding: '2px 4px',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 700,
  color: '#fff',
  marginBottom: '10px',
};

const gridStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  backgroundColor: 'rgba(148, 163, 184, 0.15)',
  marginBottom: '8px',
};

const barBgStyle: React.CSSProperties = {
  flex: 1,
  height: '4px',
  borderRadius: '2px',
  backgroundColor: 'rgba(148, 163, 184, 0.15)',
  overflow: 'hidden',
};

const barFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: '2px',
  transition: 'width 0.3s ease, background-color 0.3s ease',
};
