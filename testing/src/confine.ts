import { type Confine, seatbelt } from "@kozo/verify";

/**
 * How kozod's tests confine the diff's commands: in kozo's sandbox where there is one, so that
 * the tests run through it, and unconfined elsewhere until kozo has a sandbox there.
 */
export const testConfine: Confine =
  process.platform === "darwin" ? seatbelt : (_sandbox, argv) => argv;
