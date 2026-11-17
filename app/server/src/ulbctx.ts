/**
 * Which ULB the current request works in. Set once per request (from the signed-in user, or from the
 * work stretch behind a citizen's QR code) and read by every query, so one ULB never sees another's data.
 * Outside a request (scripts, start-up) it is GWMC (ULB 1) unless set with withUlb().
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<{ ulb: number; prefix: string }>();

/** The ULB of the current request. */
export const cur = () => store.getStore()?.ulb ?? 1;
/** Code prefix of the current ULB: '' for GWMC (its codes stay as they were), 'KMC-' for others. */
export const curPrefix = () => store.getStore()?.prefix ?? '';
export const prefixFor = (ulbId: number, code: string) => (ulbId === 1 ? '' : `${code}-`);

/** Run fn (and everything it awaits) in a ULB. */
export function withUlb<T>(ulb: number, prefix: string, fn: () => T): T {
  return store.run({ ulb, prefix }, fn);
}
