export const OFDM_PILOT_DEFINITION =
  "qpsk-v1:standard-bin-k;code=((13*k+7)^(k>>>2))&3;I=(code&1?-1:1)*sqrt(Es/2);Q=(code&2?-1:1)*sqrt(Es/2)";
/** Public fixed sequence; independent of the data/channel/noise streams. */
export function publicPilot(k: number, es: number): [number, number] {
  const code = ((13 * k + 7) ^ (k >>> 2)) & 3,
    a = Math.sqrt(es / 2);
  return [(code & 1 ? -1 : 1) * a, (code & 2 ? -1 : 1) * a];
}
