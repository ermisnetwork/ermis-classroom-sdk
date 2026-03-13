/**
 * Congestion control module — RTT-based quality estimation.
 *
 * Uses Quinn QUIC RTT to estimate network quality and compute target bitrate.
 * GCC implementation (Kalman/Overuse/AIMD) is backed up in NetworkQualityMonitor.gcc.ts
 * for future use when server-side packet group/loss tracking is complete.
 */
export { NetworkQualityMonitor } from "./NetworkQualityMonitor";
export type { ArrivalFeedback, PacketGroup, GCCStats } from "./NetworkQualityMonitor";
export { OveruseSignal, RateControlState, NetworkQuality } from "./NetworkQualityMonitor";

export { AdaptiveMediaController } from "./AdaptiveMediaController";
export type { ChannelAllocation, AllocationSummary } from "./AdaptiveMediaController";
