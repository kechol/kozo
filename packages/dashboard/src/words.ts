import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import type { Locale } from "./api.ts";

/**
 * The factory's locale, which the store sets from the status; it is English until the first
 * status says otherwise. It lives here so that api.ts can word its own errors without a cycle.
 */
export const locale = signal<Locale>("en");

/**
 * The words the page itself says, in each locale. kozod words everything else, and the page shows
 * that as it arrives. The catalog is the page's own rather than @kozo/core's, which would bring
 * zod into the bundle; a test keeps the two locales naming the same values.
 *
 * A `{name}` marks where a value goes. A space that starts or ends a sentence is part of it, for
 * the pieces the page puts next to other text.
 */
export const en = {
  "nav.views": "Views",
  "nav.inbox": "Inbox",
  "nav.board": "Board",
  "nav.waiting": " waiting",

  "factory.label": "Factory",
  "factory.paused": "Paused",
  "factory.running": "Running",
  "factory.cost": "{cost} today",
  "factory.pause": "Pause factory",
  "factory.resume": "Resume factory",
  "runs.one": "{n} run",
  "runs.other": "{n} runs",
  "runs.reading": "Reading the runs…",
  "runs.none": "No run is running now.",
  "runs.line": "{agent} on {target}",

  "inbox.summary": "{n} waiting for you, oldest first",
  "inbox.emptyTitle": "Nothing waits for you.",
  "inbox.emptyBody":
    " kozo asks here when it needs an approval, an answer or your attention, and when a branch is ready to merge.",
  "inbox.mergeNote": "Read the diff and merge the task branch yourself; kozo never merges.",
  "inbox.readPlan": "Read the plan",
  "inbox.readDiff": "Read the diff",

  "session.ended": "The session ended",
  "session.endedBody": "kozod no longer takes this tab's session, as after it starts again. ",
  "session.open":
    "Open the dashboard with {command}, which opens a session for this tab. Each link it opens works once, within a minute.",

  "unreachable.title": "kozod cannot be reached.",
  "unreachable.stale": "The page shows what it said at {time}, and tries again every few seconds.",
  "unreachable.retry": "The page tries again every few seconds.",
  "unreachable.now": "Try now",

  loading: "Loading {what}…",
  "unread.title": "kozod has not answered yet.",
  "unread.body": " The page shows {what} once it does.",
  "what.inbox": "the inbox",
  "what.board": "the board",

  "error.answered": "kozod answered {status}",

  "toasts.label": "Notifications",
  "toasts.dismiss": "Dismiss",

  "hold.start": "Start approval",
  "hold.plan": "Plan approval",
  "hold.approval": "Approval",
  "hold.question": "Question",
  "hold.attention": "Attention",
  "hold.merge": "Ready to merge",

  "ago.now": "just now",
  "ago.min": "{n} min ago",
  "ago.hour": "{n} h ago",
  "ago.day": "{n} d ago",

  "field.title": "Title",
  "field.request": "Request",
  "field.repository": "Repository",

  "addItem.new": "New item",
  "addItem.requestHint": "What to change and why",
  "addItem.chooseRepository": "Choose a repository",
  "addItem.workClass": "Work class",
  "addItem.triage": "Let triage choose",
  "addItem.adding": "Adding…",
  "addItem.add": "Add item",

  "action.back": "Back",
  "action.sending": "Sending…",
  "action.cancel": "Cancel",
  "action.cancelHint": "Why it is cancelled",
  "action.cancelAsk": "Cancel {ref}?",
  "action.cancelEnds":
    "Its runs stop, and its worktrees and task branches are removed. It closes as Cancelled and stays closed.",
  "action.done": "Close as done",
  "action.doneAsk": "Close {ref} as done?",
  "action.doneEnds":
    "Its runs stop and its worktrees are removed. It closes as Complete and stays closed.",
  "action.retry": "Retry",
  "action.retryHint": "What to do differently",
  "action.take": "Take it over",
  "action.approvePlan": "Approve plan",
  "action.approvePlanHint": "Anything the runs should know",
  "action.rejectPlan": "Reject plan",
  "action.rejectPlanHint": "What the plan should change",
  "action.approveStart": "Approve start",
  "action.approveStartHint": "Anything triage should know",
  "action.answer": "Answer",
  "action.answerHint": "Your answer",
  "action.instruct": "Instruct",
  "action.instructHint": "An instruction for this run and the ones after it",
  "action.resume": "Resume",
  "action.pause": "Pause",
  "action.giveBack": "Give it back",
  "action.giveBackHint": "What you changed and checked",

  "board.show": "Show",
  "board.items": "Items",
  "board.tasks": "Tasks",
  "board.stages": "Stages",
  "stage.intake": "intake",
  "stage.triage": "triage",
  "stage.planning": "planning",
  "stage.building": "building",
  "stage.reviewing": "reviewing",
  "stage.handoff": "handoff",
  "stage.complete": "complete",
  "stage.cancelled": "cancelled",
  "board.older": "and {n} older",
  "board.in": " in {repository}",
  "board.autonomy": "Autonomy level",
  "board.tally": "{done}/{total} tasks",
  "board.tallyHeld": ", {n} held",
  "board.tallyMerge": ", {n} ready to merge",
  "board.moveUp": "Move {ref} up",
  "board.moveDown": "Move {ref} down",
  "board.revisionsOne": "{n} revision",
  "board.revisionsOther": "{n} revisions",

  "detail.runTitle": "{agent} run",
  "detail.more": "More",
  "detail.missing": "{ref} does not exist",
  "detail.missingBody": "There is no item, task or run by that reference.",
  "detail.toInbox": "Go to the inbox",
  "detail.toBoard": "Go to the board",
  "detail.breadcrumb": "Breadcrumb",
  "detail.properties": "Properties",
  "prop.class": "Class",
  "prop.risk": "Risk",
  "prop.level": "Level",
  "prop.revisions": "Revisions",
  "prop.scope": "Scope",
  "prop.after": "After",
  "prop.branch": "Branch",
  "prop.agent": "Agent",
  "prop.model": "Model",
  "prop.started": "Started",
  "prop.ended": "Ended",
  "prop.events": "Events",
  "prop.cost": "Cost",
  "detail.doneWhen": "Done when",
  "detail.tasks": "Tasks",
  "detail.characterizes": " characterizes first",
  "detail.after": " after {ids}",
  "detail.draftPlan": "Draft plan waiting for approval",
  "detail.plan": "Plan",
  "detail.requestEmpty": "The request has a title only.",
  "detail.runReport": "Run report",
  "detail.outOfScope": "Noticed out of scope",
  "detail.review": "Review",
  "detail.verify": "Verify",
  "detail.met": "Met: ",
  "detail.notMet": "Not met: ",
  "detail.decisionLog": "Decision log",
  "detail.blueprint": "Blueprint",
  "detail.blueprintIn": " in {run}",
  "detail.mergeBody":
    "Read the diff, then merge {branch} into {base} in {repository} yourself; kozo never merges.",
  "detail.copyBranch": "Copy the branch name",
  "detail.copied": "Copied {branch}",
  "detail.handoff": "Handoff report",
  "detail.handoffAt": "at {head}",
  "detail.diff": "Diff",
  "detail.diffCut": "The diff is longer; kozo show --diff prints all of it.",
  "detail.diffReading": "Reading the diff…",
  "detail.diffShow": "Show the diff",
  "detail.diffEmpty": "The branch changes nothing yet.",
  "detail.evidence": "evidence {path}",
  "detail.runs": "Runs",
  "detail.events": "Events",
  "detail.eventsNone": "No events yet.",

  "event.holdSet": "{target} held for {hold}: {reason}",
  "event.holdCleared": "{target} {hold} cleared",
  "event.runStarted": "{agent} run started on {model}",
  "event.runChanged": "run {from} → {to}",
  "event.entered": "entered",
  "event.passed": "passed",
  "event.failed": "failed",
  "event.gates": "{level} gates {status}",
  "event.gatesAt": "{level} gates {status} at {failed}",
  "event.review": "review: {verdict}, {summary}",
  "event.called": "called {tool}",
  "event.guard": "the guard refused {tool}: {reason}",
  "event.ready": "ready at {head}",
} as const;

export type Word = keyof typeof en;

/** The Japanese of every word, in the style of the Japanese documentation. */
export const ja: Record<Word, string> = {
  "nav.views": "画面",
  "nav.inbox": "対応待ち",
  "nav.board": "ボード",
  "nav.waiting": " 件待ち",

  "factory.label": "ファクトリー",
  "factory.paused": "停止中",
  "factory.running": "稼働中",
  "factory.cost": "今日 {cost}",
  "factory.pause": "ファクトリーを止める",
  "factory.resume": "ファクトリーを再開する",
  "runs.one": "{n} 件の run",
  "runs.other": "{n} 件の run",
  "runs.reading": "run を読み込み中…",
  "runs.none": "動いている run はありません。",
  "runs.line": "{agent}（{target}）",

  "inbox.summary": "あなたを待っているものが {n} 件あります（古い順）",
  "inbox.emptyTitle": "待っているものはありません。",
  "inbox.emptyBody":
    "承認や回答、対応が必要なときと、ブランチをマージできるようになったときに、kozo がここで知らせます。",
  "inbox.mergeNote":
    "差分を読み、タスクのブランチを自分でマージしてください。kozo はマージしません。",
  "inbox.readPlan": "計画を読む",
  "inbox.readDiff": "差分を読む",

  "session.ended": "セッションが終了しました",
  "session.endedBody": "kozod がこのタブのセッションを受け付けなくなりました（再起動後など）。",
  "session.open":
    "{command} でダッシュボードを開いてください。このタブのセッションが開きます。開くリンクは 1 回しか使えず、有効なのは 1 分です。",

  "unreachable.title": "kozod に接続できません。",
  "unreachable.stale": "{time} 時点の状態を表示しています。数秒ごとに再接続を試みます。",
  "unreachable.retry": "数秒ごとに再接続を試みます。",
  "unreachable.now": "今すぐ試す",

  loading: "{what} を読み込み中…",
  "unread.title": "kozod がまだ応答していません。",
  "unread.body": "応答があり次第、{what} を表示します。",
  "what.inbox": "対応待ち",
  "what.board": "ボード",

  "error.answered": "kozod が {status} を返しました",

  "toasts.label": "通知",
  "toasts.dismiss": "閉じる",

  "hold.start": "開始の承認",
  "hold.plan": "計画の承認",
  "hold.approval": "承認",
  "hold.question": "質問",
  "hold.attention": "要対応",
  "hold.merge": "マージ待ち",

  "ago.now": "たった今",
  "ago.min": "{n} 分前",
  "ago.hour": "{n} 時間前",
  "ago.day": "{n} 日前",

  "field.title": "タイトル",
  "field.request": "依頼",
  "field.repository": "リポジトリ",

  "addItem.new": "新規 item",
  "addItem.requestHint": "何をなぜ変えるか",
  "addItem.chooseRepository": "リポジトリを選択",
  "addItem.workClass": "作業の種類",
  "addItem.triage": "triage に任せる",
  "addItem.adding": "追加中…",
  "addItem.add": "item を追加",

  "action.back": "戻る",
  "action.sending": "送信中…",
  "action.cancel": "取り消す",
  "action.cancelHint": "取り消す理由",
  "action.cancelAsk": "{ref} を取り消しますか？",
  "action.cancelEnds":
    "run は止まり、worktree とタスクのブランチは削除されます。取り消しとして閉じ、閉じたままになります。",
  "action.done": "完了として閉じる",
  "action.doneAsk": "{ref} を完了として閉じますか？",
  "action.doneEnds":
    "run は止まり、worktree は削除されます。完了として閉じ、閉じたままになります。",
  "action.retry": "やり直す",
  "action.retryHint": "変えてほしい点",
  "action.take": "引き取る",
  "action.approvePlan": "計画を承認",
  "action.approvePlanHint": "run に伝えておくこと",
  "action.rejectPlan": "計画を差し戻す",
  "action.rejectPlanHint": "計画で変えてほしい点",
  "action.approveStart": "開始を承認",
  "action.approveStartHint": "triage に伝えておくこと",
  "action.answer": "回答",
  "action.answerHint": "回答の内容",
  "action.instruct": "指示",
  "action.instructHint": "この run と、以降の run への指示",
  "action.resume": "再開する",
  "action.pause": "止める",
  "action.giveBack": "kozo に返す",
  "action.giveBackHint": "変更した内容と、確認したこと",

  "board.show": "表示",
  "board.items": "item",
  "board.tasks": "タスク",
  "board.stages": "段階",
  "stage.intake": "受付",
  "stage.triage": "トリアージ",
  "stage.planning": "計画",
  "stage.building": "実装",
  "stage.reviewing": "レビュー",
  "stage.handoff": "引き渡し",
  "stage.complete": "完了",
  "stage.cancelled": "取り消し",
  "board.older": "さらに古い {n} 件",
  "board.in": "（{repository}）",
  "board.autonomy": "自律度",
  "board.tally": "{done}/{total} タスク",
  "board.tallyHeld": "、hold {n}",
  "board.tallyMerge": "、マージ待ち {n}",
  "board.moveUp": "{ref} を上へ移動",
  "board.moveDown": "{ref} を下へ移動",
  "board.revisionsOne": "修正 {n} 回",
  "board.revisionsOther": "修正 {n} 回",

  "detail.runTitle": "{agent} の run",
  "detail.more": "その他",
  "detail.missing": "{ref} は存在しません",
  "detail.missingBody": "この reference の item、タスク、run はありません。",
  "detail.toInbox": "対応待ちへ移動",
  "detail.toBoard": "ボードへ移動",
  "detail.breadcrumb": "パンくずリスト",
  "detail.properties": "プロパティ",
  "prop.class": "作業の種類",
  "prop.risk": "リスク",
  "prop.level": "自律度",
  "prop.revisions": "修正回数",
  "prop.scope": "範囲",
  "prop.after": "依存先",
  "prop.branch": "ブランチ",
  "prop.agent": "エージェント",
  "prop.model": "モデル",
  "prop.started": "開始",
  "prop.ended": "終了",
  "prop.events": "イベント",
  "prop.cost": "費用",
  "detail.doneWhen": "完了の条件",
  "detail.tasks": "タスク",
  "detail.characterizes": " 先に characterize",
  "detail.after": " {ids} の後",
  "detail.draftPlan": "承認待ちの計画（下書き）",
  "detail.plan": "計画",
  "detail.requestEmpty": "依頼はタイトルだけです。",
  "detail.runReport": "実行の報告",
  "detail.outOfScope": "scope 外で気づいたこと",
  "detail.review": "レビュー",
  "detail.verify": "動作確認",
  "detail.met": "達成: ",
  "detail.notMet": "未達成: ",
  "detail.decisionLog": "判断の記録",
  "detail.blueprint": "工程",
  "detail.blueprintIn": "（{run}）",
  "detail.mergeBody":
    "差分を読み、{repository} の {branch} を {base} に自分でマージしてください。kozo はマージしません。",
  "detail.copyBranch": "ブランチ名をコピー",
  "detail.copied": "{branch} をコピーしました",
  "detail.handoff": "引き渡しの報告",
  "detail.handoffAt": "{head} 時点",
  "detail.diff": "差分",
  "detail.diffCut": "差分はここで切れています。全体は kozo show --diff で表示できます。",
  "detail.diffReading": "差分を読み込み中…",
  "detail.diffShow": "差分を表示",
  "detail.diffEmpty": "ブランチにはまだ変更がありません。",
  "detail.evidence": "証拠 {path}",
  "detail.runs": "実行の履歴",
  "detail.events": "イベント",
  "detail.eventsNone": "event はまだありません。",

  "event.holdSet": "{target} に hold（{hold}）: {reason}",
  "event.holdCleared": "{target} の hold（{hold}）を解除",
  "event.runStarted": "{agent} の run を {model} で開始",
  "event.runChanged": "run {from} → {to}",
  "event.entered": "開始",
  "event.passed": "通過",
  "event.failed": "失敗",
  "event.gates": "{level} gates: {status}",
  "event.gatesAt": "{level} gates: {status}（{failed}）",
  "event.review": "review: {verdict}、{summary}",
  "event.called": "{tool} を呼び出し",
  "event.guard": "guard が {tool} を拒否: {reason}",
  "event.ready": "{head} で準備完了",
};

export const catalogs: Record<Locale, Record<Word, string>> = { en, ja };

/** The names of the `{name}` values in a sentence. */
type Names<Sentence extends string> = Sentence extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Names<Rest>
  : never;

type Values<Key extends Word, Value> = [Names<(typeof en)[Key]>] extends [never]
  ? []
  : [Record<Names<(typeof en)[Key]>, Value>];

/** A sentence cut at its `{name}`s, with each name replaced by its value. */
export function fill<Value>(sentence: string, values: Record<string, Value>): (string | Value)[] {
  return sentence
    .split(/\{(\w+)\}/)
    .map((piece, index) => (index % 2 === 0 ? piece : (values[piece] ?? "")))
    .filter((piece) => piece !== "");
}

/** The word `key` in `loc`, with its values in place. */
export function say<Key extends Word>(
  loc: Locale,
  key: Key,
  ...values: Values<Key, string | number>
): string {
  return fill<string | number>(catalogs[loc][key], values[0] ?? {}).join("");
}

/** The word `key` in the factory's locale; read while rendering, it re-renders when the locale changes. */
export function t<Key extends Word>(key: Key, ...values: Values<Key, string | number>): string {
  return say(locale.value, key, ...values);
}

/** Like `t`, for a sentence that has elements in it, such as a command in `<code>`. */
export function tx<Key extends Word>(
  key: Key,
  ...values: Values<Key, ComponentChildren>
): ComponentChildren[] {
  return fill<ComponentChildren>(catalogs[locale.value][key], values[0] ?? {});
}

const stageWords: Record<string, Word> = {
  intake: "stage.intake",
  triage: "stage.triage",
  planning: "stage.planning",
  building: "stage.building",
  reviewing: "stage.reviewing",
  handoff: "stage.handoff",
  complete: "stage.complete",
  cancelled: "stage.cancelled",
};

/** A stage as people read it in the current locale; one kozod does not name stays as it came. */
export function stageName(stage: string): string {
  const word = stageWords[stage];
  return word ? t(word as "stage.intake") : stage;
}
