import { type Confine, platformConfine } from "@kozo/verify";

/**
 * How kozod's tests confine the diff's commands: in this machine's sandbox where it runs, so
 * that the tests run through it, and unconfined where it does not, such as a CI runner that
 * keeps bubblewrap from creating namespaces.
 */
export const testConfine: Confine = await platformConfine().catch(
  (): Confine => (_sandbox, argv) => argv,
);
