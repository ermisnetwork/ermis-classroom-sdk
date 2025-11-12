/* tslint:disable */
/* eslint-disable */
export function start(): void;
export function test(): void;
export function add(a: number, b: number): number;
export function createAacDecoder(extra_data: Uint8Array): AacWasmDecoder;
export class AacWasmDecoder {
  private constructor();
  free(): void;
  decode(aac_data: Uint8Array, duration: bigint, pts: bigint): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly start: () => void;
  readonly add: (a: number, b: number) => number;
  readonly __wbg_aacwasmdecoder_free: (a: number, b: number) => void;
  readonly createAacDecoder: (a: number, b: number) => [number, number, number];
  readonly aacwasmdecoder_decode: (a: number, b: number, c: number, d: bigint, e: bigint) => [number, number, number, number];
  readonly test: () => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_3: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
