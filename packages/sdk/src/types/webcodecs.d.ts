/**
 * WebCodecs API Type Declarations
 * For MediaStreamTrackGenerator and related APIs
 */

declare global {
  interface MediaStreamTrackGenerator extends MediaStreamTrack {
    readonly writable: WritableStream<VideoFrame | AudioData>;
  }

  interface MediaStreamTrackGeneratorInit {
    kind: "video" | "audio";
  }

  const MediaStreamTrackGenerator: {
    prototype: MediaStreamTrackGenerator;
    new (init: MediaStreamTrackGeneratorInit): MediaStreamTrackGenerator;
  };

  interface VideoFrame {
    readonly codedWidth: number;
    readonly codedHeight: number;
    readonly timestamp: number;
    readonly duration: number | null;
    close(): void;
  }

  interface AudioData {
    readonly sampleRate: number;
    readonly numberOfFrames: number;
    readonly numberOfChannels: number;
    readonly timestamp: number;
    close(): void;
  }
}

export {};
