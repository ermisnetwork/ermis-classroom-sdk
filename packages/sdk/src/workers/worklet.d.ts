/**
 * Type declarations for AudioWorklet API
 */

declare class AudioWorkletProcessor {
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

declare function registerProcessor(
    name: string,
    processorCtor: new () => AudioWorkletProcessor
): void;

declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

interface AudioParamDescriptor {
    name: string;
    automationRate?: 'a-rate' | 'k-rate';
    defaultValue?: number;
    minValue?: number;
    maxValue?: number;
}

interface AudioWorkletProcessorConstructor {
    new(options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
    parameterDescriptors?: AudioParamDescriptor[];
}
