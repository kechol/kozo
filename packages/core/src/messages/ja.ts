import type { en } from "./en.ts";

/** The Japanese sentence of every message, with the same values as its English one. */
export const ja: { readonly [Code in keyof typeof en]: string } = {
  "notice.ready": "{task} のレビューとマージの準備ができました",
  "notice.held.approval": "{subject} があなたの承認を待っています（{reason}）",
  "notice.held.question": "{subject} があなたの回答を待っています（{reason}）",
  "notice.held.attention": "{subject} があなたの対応を待っています（{reason}）",
  "notice.paused": "ファクトリーが止まりました（{reason}）",
  "notice.refused": "kozod が factory definition を拒みました（{issues}）",
  "notice.demoted":
    "kozod が {repository} の {class} の自律度を {from} から {to} に下げました（{reason}）。下げた状態は、Charter を変えるまで続きます",
  "notice.budget-spent":
    "1 日の予算 {budget} USD を使い切りました。午前 0 時まで新しい作業を始めません",
  "notice.budget-share": "1 日の予算 {budget} USD の {percent}% を使いました",
  "notice.reminder": "{subject} があなたの承認を {days} 日待っています（{reason}）",
};
