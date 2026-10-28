import { describe, expect, test } from "bun:test";
import { Outbox } from "./command.ts";

/**
 * A socket whose buffer holds `room` bytes and stays full until `free` empties it, as a real
 * socket stays full until its drain event.
 */
function narrowSocket(room: number) {
  const taken: number[] = [];
  let left = room;
  let ended = false;
  return {
    taken,
    get ended() {
      return ended;
    },
    free() {
      left = room;
    },
    write(bytes: Uint8Array) {
      const count = Math.min(left, bytes.length);
      taken.push(...bytes.subarray(0, count));
      left -= count;
      return count;
    },
    end() {
      ended = true;
    },
  };
}

describe("Outbox", () => {
  test("keeps what the socket could not take until it drains, in order", () => {
    const socket = narrowSocket(3);
    const out = new Outbox(socket);
    out.write(new Uint8Array([1, 2, 3, 4, 5]));
    out.write(new Uint8Array([6, 7]));
    expect(socket.taken).toEqual([1, 2, 3]);
    socket.free();
    out.drain();
    expect(socket.taken).toEqual([1, 2, 3, 4, 5, 6]);
    socket.free();
    out.drain();
    expect(socket.taken).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("ends the socket only once everything written has gone", () => {
    const socket = narrowSocket(2);
    const out = new Outbox(socket);
    out.write(new Uint8Array([1, 2, 3]));
    out.end();
    expect(socket.ended).toBe(false);
    socket.free();
    out.drain();
    expect(socket.taken).toEqual([1, 2, 3]);
    expect(socket.ended).toBe(true);
  });

  test("a socket that takes nothing keeps the whole message and stays open", () => {
    const socket = narrowSocket(0);
    const out = new Outbox(socket);
    out.write(new Uint8Array([9]));
    out.end();
    out.drain();
    expect(socket.taken).toEqual([]);
    expect(socket.ended).toBe(false);
  });
});
