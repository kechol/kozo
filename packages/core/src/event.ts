import { z } from "zod";
import { gateLevelSchema } from "./constraints.ts";
import { type ParseResult, parseJsonDocument } from "./document.ts";
import { planSchema } from "./plan.ts";
import {
  formatItemReference,
  itemReferenceSchema,
  parseReference,
  runReferenceSchema,
  taskReferenceSchema,
} from "./reference.ts";
import { reviewVerdictSchema } from "./verdict.ts";
import { agentNameSchema, holdKindSchema, runStateSchema, stageSchema } from "./work-model.ts";

const text = z.string().min(1);
const amount = z.number().nonnegative();
const tokens = z.int().nonnegative();
const costSchema = z.strictObject({ usd: amount, in: tokens, out: tokens, cache_read: tokens });
/** Whether a stage or hold event is about the item or about the task of its line. */
const target = z.enum(["item", "task"]);
const actor = z.enum(["human", "kozod"]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * What a note is: a human's answer, instruction, approval text or rejection, or the output of
 * kozod's failed check at Complete, which the diff's code can shape.
 */
export const noteKindSchema = z.enum(["answer", "instruction", "approval", "rejection", "check"]);
export type NoteKind = z.infer<typeof noteKindSchema>;

const envelope = {
  v: z.literal(1),
  ts: z.iso.datetime(),
  /** The SHA-256 of the previous line of the same log, null on its first line. */
  prev: sha256.nullable(),
  /** Null for events outside any run, which kozod keeps in its own log. */
  run_id: runReferenceSchema.nullable(),
  parent_run: runReferenceSchema.nullable(),
  /** Null for factory-wide events. */
  item: itemReferenceSchema.nullable(),
  task: taskReferenceSchema.nullable(),
  /** The line's position in its log, counted from 0 without gaps. */
  seq: z.int().nonnegative(),
  node: text.nullable(),
  /** What this event added to the run's cost; `cost.tick` carries the running total. */
  cost: costSchema,
};

const event = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.strictObject({ ...envelope, type: z.literal(type), data });

export const eventSchema = z
  .discriminatedUnion("type", [
    event(
      "run.started",
      z.strictObject({
        agent: agentNameSchema,
        model: text,
        mode: z.enum(["local", "github"]),
        /** The default-branch commit whose Charter the run follows. */
        charter_commit: text,
        /** Null while kozod runs on its built-in factory defaults. */
        factory_commit: text.nullable(),
      }),
    ),
    event(
      "run.changed",
      z.strictObject({ from: runStateSchema, to: runStateSchema, reason: text.optional() }),
    ),
    event(
      "item.created",
      z.strictObject({
        /** The registered repository the item is for, by its path in `factory.yml`. */
        repository: text,
        title: text,
        source: z.enum(["local", "github", "automation"]),
      }),
    ),
    event("factory.changed", z.strictObject({ paused: z.boolean(), reason: text })),
    /** The run's log as it ended; nothing is appended to it afterwards. */
    event(
      "log.sealed",
      z.strictObject({ run: runReferenceSchema, lines: z.int().positive(), last: sha256 }),
    ),
    event(
      "stage.changed",
      z.strictObject({ target, from: stageSchema.nullable(), to: stageSchema }),
    ),
    event("hold.set", z.strictObject({ target, hold: holdKindSchema, reason: text })),
    event(
      "hold.cleared",
      z.strictObject({ target, hold: holdKindSchema, by: actor, reason: text.optional() }),
    ),
    /** A note about the event's task, or about its item when the task is null. */
    event("note.added", z.strictObject({ kind: noteKindSchema, text })),
    event("plan.proposed", z.strictObject({ plan: planSchema })),
    event("plan.accepted", z.strictObject({ plan: planSchema, by: actor })),
    event("node.enter", z.strictObject({ kind: z.enum(["D", "A"]) })),
    event("node.exit", z.strictObject({ ok: z.boolean(), summary: text.optional() })),
    event("agent.message", z.strictObject({ agent: agentNameSchema, text })),
    event("tool.call", z.strictObject({ call_id: text, tool: text, input: z.unknown() })),
    event(
      "tool.result",
      z
        .strictObject({
          call_id: text,
          is_error: z.boolean(),
          output: z.unknown().optional(),
          /** A large output is stored beside the log, and only its path is kept here. */
          output_path: text.optional(),
        })
        .refine(
          (data) => (data.output === undefined) !== (data.output_path === undefined),
          "Give either output or output_path",
        ),
    ),
    event("instruction.delivered", z.strictObject({ queue_seq: tokens, text })),
    /** `head` is the task branch's commit at the checkpoint, null before the branch exists. */
    event("checkpoint", z.strictObject({ head: text.nullable() })),
    event(
      "gates.result",
      z.discriminatedUnion("status", [
        z.strictObject({ level: gateLevelSchema, status: z.literal("pass") }),
        z.strictObject({ level: gateLevelSchema, status: z.literal("fail"), failed: text }),
        z.strictObject({
          level: gateLevelSchema,
          status: z.literal("MISCONFIGURED"),
          reason: text,
        }),
      ]),
    ),
    event("review.verdict", z.strictObject({ verdict: reviewVerdictSchema, summary: text })),
    event(
      "external.write",
      z.strictObject({ target: z.enum(["github", "local"]), action: text, subject: text }),
    ),
    event("cost.tick", costSchema),
  ])
  .superRefine((line, context) => {
    const task = line.task === null ? null : parseReference(line.task);
    if (task?.kind === "task" && formatItemReference(task.item) !== line.item) {
      context.addIssue({ code: "custom", path: ["task"], message: "The task is not of this item" });
    }
    if (line.parent_run !== null && line.run_id === null) {
      context.addIssue({
        code: "custom",
        path: ["parent_run"],
        message: "Only a run has a parent",
      });
    }
    if (line.type.startsWith("run.") && line.run_id === null) {
      context.addIssue({ code: "custom", path: ["run_id"], message: `${line.type} needs a run` });
    }
    if (line.type === "log.sealed" && line.run_id !== null) {
      context.addIssue({
        code: "custom",
        path: ["run_id"],
        message: "A seal goes to kozod's own log",
      });
    }
    const factoryWide = line.type === "factory.changed";
    if (factoryWide !== (line.item === null)) {
      context.addIssue({
        code: "custom",
        path: ["item"],
        message: factoryWide ? "A factory event has no item" : `${line.type} needs an item`,
      });
    }
  });
export type Event = z.infer<typeof eventSchema>;
export type EventType = Event["type"];

/** Parses one line of `events.jsonl`; an unknown version or type is an issue, never skipped. */
export function parseEvent(line: string): ParseResult<Event> {
  return parseJsonDocument(eventSchema, line);
}
