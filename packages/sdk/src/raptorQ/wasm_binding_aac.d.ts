/* tslint:disable */
/* eslint-disable */
export class WasmDecoder {
  free(): void;
  constructor(k: number, block_size: number);
  add_symbol(symbol_id: number, data: Uint8Array): boolean;
  is_decoded(): boolean;
  get_decoded(): Uint8Array | undefined;
}
export class WasmEncoder {
  free(): void;
  constructor(data: Uint8Array, k: number, block_size: number);
  encode(symbol_id: number): Uint8Array;
  get_k(): number;
  get_block_size(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmencoder_free: (a: number, b: number) => void;
  readonly wasmencoder_new: (a: number, b: number, c: number, d: number) => number;
  readonly wasmencoder_encode: (a: number, b: number) => any;
  readonly wasmencoder_get_k: (a: number) => number;
  readonly wasmencoder_get_block_size: (a: number) => number;
  readonly __wbg_wasmdecoder_free: (a: number, b: number) => void;
  readonly wasmdecoder_new: (a: number, b: number) => number;
  readonly wasmdecoder_add_symbol: (a: number, b: number, c: number, d: number) => number;
  readonly wasmdecoder_is_decoded: (a: number) => number;
  readonly wasmdecoder_get_decoded: (a: number) => any;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
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
export default function __wbg_init(module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
