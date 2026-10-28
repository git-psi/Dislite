export const DISCORD_EPOCH = 1420070400000;

export const snowflakeTime = (id: string) => Number(BigInt(id) >> 22n) + DISCORD_EPOCH;

/** Nonce au format snowflake, comme le client officiel. */
export const makeNonce = () => (BigInt(Date.now() - DISCORD_EPOCH) << 22n).toString();

/** Compare deux snowflakes sans BigInt : longueur puis ordre lexical. */
export function compareSnowflakes(a?: string | null, b?: string | null): number {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isNewer = (a?: string | null, b?: string | null) => compareSnowflakes(a, b) > 0;
