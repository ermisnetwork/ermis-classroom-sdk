/* tslint:disable */
/* eslint-disable */
export class WasmDecoder {
  free(): void;
  [Symbol.dispose](): void;
  constructor(config_buffer: Uint8Array);
  /**
   * Decode a packet. Returns decoded data if decoding is complete, otherwise returns null
   */
  decode(packet_data: Uint8Array): Uint8Array | undefined;
}
export class WasmEncoder {
  free(): void;
  [Symbol.dispose](): void;
  constructor(data: Uint8Array, mtu: number);
  encode(repair_packets_count: number): Array<any>;
  getMTU(): number;
  getConfigBuffer(): Uint8Array;
}
export class WasmFecManager {
  free(): void;
  [Symbol.dispose](): void;
  constructor();
  /**
   * Process a FEC packet with chunk_id
   * Returns an array of [chunk_id, decoded_data] pairs that are ready to be consumed
   * The array may contain multiple items if jitter buffer releases multiple sequential chunks
   */
  process_fec_packet(data: Uint8Array, chunk_id: number): Array<any> | undefined;
  get_last_decoded_sequence(): number;
  get_buffer_size(): number;
  clear(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmencoder_free: (a: number, b: number) => void;
  readonly wasmencoder_new: (a: number, b: number, c: number) => number;
  readonly wasmencoder_encode: (a: number, b: number) => any;
  readonly wasmencoder_getMTU: (a: number) => number;
  readonly wasmencoder_getConfigBuffer: (a: number) => any;
  readonly __wbg_wasmdecoder_free: (a: number, b: number) => void;
  readonly wasmdecoder_new: (a: number, b: number) => [number, number, number];
  readonly wasmdecoder_decode: (a: number, b: number, c: number) => any;
  readonly __wbg_wasmfecmanager_free: (a: number, b: number) => void;
  readonly wasmfecmanager_new: () => number;
  readonly wasmfecmanager_process_fec_packet: (a: number, b: number, c: number, d: number) => any;
  readonly wasmfecmanager_get_last_decoded_sequence: (a: number) => number;
  readonly wasmfecmanager_get_buffer_size: (a: number) => number;
  readonly wasmfecmanager_clear: (a: number) => void;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
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
