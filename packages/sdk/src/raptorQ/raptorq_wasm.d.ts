/* tslint:disable */
/* eslint-disable */
/**
*/
export class WasmDecoder {
  free(): void;
/**
* @param {Uint8Array} config_buffer
*/
  constructor(config_buffer: Uint8Array);
/**
* Decode a packet. Returns decoded data if decoding is complete, otherwise returns null
* @param {Uint8Array} packet_data
* @returns {Uint8Array | undefined}
*/
  decode(packet_data: Uint8Array): Uint8Array | undefined;
}
/**
*/
export class WasmEncoder {
  free(): void;
/**
* @returns {Uint8Array}
*/
  getConfigBuffer(): Uint8Array;
/**
* @param {Uint8Array} data
* @param {number} mtu
*/
  constructor(data: Uint8Array, mtu: number);
/**
* @param {number} repair_packets_count
* @returns {Array<any>}
*/
  encode(repair_packets_count: number): Array<any>;
/**
* @returns {number}
*/
  getMTU(): number;
}
/**
*/
export class WasmFecManager {
  free(): void;
/**
* @returns {number}
*/
  get_buffer_size(): number;
/**
* Process a FEC packet with chunk_id
* Returns an array of [chunk_id, decoded_data] pairs that are ready to be consumed
* The array may contain multiple items if jitter buffer releases multiple sequential chunks
* @param {Uint8Array} data
* @param {number} chunk_id
* @returns {Array<any> | undefined}
*/
  process_fec_packet(data: Uint8Array, chunk_id: number): Array<any> | undefined;
/**
* @returns {number}
*/
  get_last_decoded_sequence(): number;
/**
*/
  constructor();
/**
*/
  clear(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_wasmdecoder_free: (a: number) => void;
  readonly __wbg_wasmencoder_free: (a: number) => void;
  readonly __wbg_wasmfecmanager_free: (a: number) => void;
  readonly wasmdecoder_decode: (a: number, b: number, c: number) => number;
  readonly wasmdecoder_new: (a: number, b: number, c: number) => void;
  readonly wasmencoder_encode: (a: number, b: number) => number;
  readonly wasmencoder_getConfigBuffer: (a: number) => number;
  readonly wasmencoder_getMTU: (a: number) => number;
  readonly wasmencoder_new: (a: number, b: number, c: number) => number;
  readonly wasmfecmanager_clear: (a: number) => void;
  readonly wasmfecmanager_get_buffer_size: (a: number) => number;
  readonly wasmfecmanager_get_last_decoded_sequence: (a: number) => number;
  readonly wasmfecmanager_new: () => number;
  readonly wasmfecmanager_process_fec_packet: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {SyncInitInput} module
*
* @returns {InitOutput}
*/
export function initSync(module: SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {InitInput | Promise<InitInput>} module_or_path
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
