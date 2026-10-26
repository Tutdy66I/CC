import { xoshiro128StarStar } from "./fadingRandom.js";
import { OFDM_RANDOM } from "./ofdmProtocol.js";
export type OfdmRole =
  | "channel"
  | "data"
  | "training-body"
  | "data-body"
  | "training-prefix"
  | "data-prefix";
const roles: OfdmRole[] = [
  "channel",
  "data",
  "training-body",
  "data-body",
  "training-prefix",
  "data-prefix",
];
export async function deriveOfdmState(
  seed: number,
  trial: number,
  role: OfdmRole,
  slot: number,
): Promise<[number, number, number, number]> {
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isSafeInteger(trial) ||
    trial < 0 ||
    !roles.includes(role) ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 8
  )
    throw new Error("OFDM 随机域参数无效。");
  const digest = new DataView(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `${OFDM_RANDOM}|${seed}|${trial}|${role}|${slot}`,
      ),
    ),
  );
  const state = [0, 4, 8, 12].map((i) => digest.getUint32(i, true)) as [
    number,
    number,
    number,
    number,
  ];
  if (state.every((x) => x === 0)) throw new Error("随机状态全零。");
  return state;
}
export async function createOfdmRandom(
  seed: number,
  trial: number,
  role: OfdmRole,
  slot: number,
) {
  const uniform = xoshiro128StarStar(
    await deriveOfdmState(seed, trial, role, slot),
  );
  return {
    uniform,
    complex(): [number, number] {
      const r = Math.sqrt(-2 * Math.log(1 - uniform())) / Math.SQRT2,
        a = 2 * Math.PI * uniform();
      return [r * Math.cos(a), r * Math.sin(a)];
    },
  };
}
