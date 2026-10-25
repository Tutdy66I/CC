import type { Complex } from "./channelTypes.js";

export const FADING_RANDOM_VERSION = "signallab-channel-rng-v1" as const;
export const FADING_RANDOM_PROTOCOL = {
  version: FADING_RANDOM_VERSION,
  digest: "SHA-256",
  input: "signallab-channel-rng-v1|<seed-decimal>|<frame-decimal>|<role>",
  initialization:
    "first 16 digest bytes as four little-endian uint32; reject all zero",
  generator: "xoshiro128** 1.1; uint32 output / 2^32",
  gaussian:
    "Box-Muller pair: sqrt(-2*ln(1-u1))*(cos(2*pi*u2),sin(2*pi*u2))/sqrt(2)",
  roles: ["data", "channel", "noise"],
  data: "four Bernoulli bits per absolute symbol; bit=uniform()<0.5?0:1",
  pairing: "seed/frame/role only; excludes model, pilots, SNR and method",
} as const;
export type FadingRole = "data" | "channel" | "noise";
export type FadingState = [number, number, number, number];

/** Frozen SHA-256 domain; the first four words are read little-endian. */
export async function deriveFadingState(
  seed: number,
  frame: number,
  role: FadingRole,
): Promise<FadingState> {
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    !["data", "channel", "noise"].includes(role)
  ) {
    throw new Error("衰落随机流的种子、帧或角色无效。");
  }
  const input = new TextEncoder().encode(
    `${FADING_RANDOM_VERSION}|${seed}|${frame}|${role}`,
  );
  const digest = new DataView(await crypto.subtle.digest("SHA-256", input));
  const state: FadingState = [0, 4, 8, 12].map((offset) =>
    digest.getUint32(offset, true),
  ) as FadingState;
  if (state.every((word) => word === 0)) throw new Error("随机状态不能全零。");
  return state;
}

const rotateLeft = (value: number, shift: number) =>
  ((value << shift) | (value >>> (32 - shift))) >>> 0;

/** xoshiro128** 1.1, uint32 arithmetic, output in [0,1). */
export function xoshiro128StarStar(initial: readonly number[]): () => number {
  if (
    initial.length !== 4 ||
    initial.some(
      (word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff,
    ) ||
    initial.every((word) => word === 0)
  ) {
    throw new Error("xoshiro 状态须为四个 uint32 且不能全零。");
  }
  const s = [...initial];
  return () => {
    const result = Math.imul(rotateLeft(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotateLeft(s[3], 11);
    return result / 0x100000000;
  };
}

export async function createFadingRandom(
  seed: number,
  frame: number,
  role: FadingRole,
) {
  const uniform = xoshiro128StarStar(
    await deriveFadingState(seed, frame, role),
  );
  return {
    uniform,
    /** A Box-Muller pair, divided by sqrt(2): E|z|^2=1. Never normalize a realization. */
    complex(): Complex {
      const radius = Math.sqrt(-2 * Math.log(1 - uniform())) / Math.SQRT2;
      const angle = 2 * Math.PI * uniform();
      return { i: radius * Math.cos(angle), q: radius * Math.sin(angle) };
    },
  };
}
