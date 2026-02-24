/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export function __wbg_wasmdecoder_free(a: number): void;
export function __wbg_wasmencoder_free(a: number): void;
export function __wbg_wasmfecmanager_free(a: number): void;
export function wasmdecoder_decode(a: number, b: number, c: number): number;
export function wasmdecoder_new(a: number, b: number, c: number): void;
export function wasmencoder_encode(a: number, b: number): number;
export function wasmencoder_getConfigBuffer(a: number): number;
export function wasmencoder_getMTU(a: number): number;
export function wasmencoder_new(a: number, b: number, c: number): number;
export function wasmfecmanager_clear(a: number): void;
export function wasmfecmanager_get_buffer_size(a: number): number;
export function wasmfecmanager_get_last_decoded_sequence(a: number): number;
export function wasmfecmanager_new(): number;
export function wasmfecmanager_process_fec_packet(a: number, b: number, c: number, d: number): number;
export function __wbindgen_add_to_stack_pointer(a: number): number;
export function __wbindgen_malloc(a: number, b: number): number;
