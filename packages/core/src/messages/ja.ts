import type { en } from "./en.ts";

/** The Japanese sentence of every message, with the same values as its English one. */
export const ja: { readonly [Code in keyof typeof en]: string } = {
  text: "{text}",
  "hold.start-approval": "開始の承認",
  "hold.plan-approval": "計画の承認",
  "hold.pause": "kozo pause",
  "hold.take": "kozo take",
  "hold.rejected-twice": "計画が 2 回差し戻されました。kozo retry で Triage から下書きし直します",
  "hold.could-not-run": "kozod が実行できませんでした（{error}）",
  "hold.capacity.charter": "Charter のため、このリポジトリでは作業できません（{reason}）",
  "hold.capacity.budget-spent": "1 日の予算 {budget} USD を使い切りました",
  "hold.capacity.budget-held":
    "1 日の予算 {budget} USD を、使い切ったか、動いている作業のために確保しています",
  "hold.capacity.awaiting-merge":
    "{count} 件のタスクがマージを待っていて、Charter の上限に達しています",
  "hold.capacity.held":
    "{count} 件の item とタスクが質問か対応を待っていて、Charter の上限に達しています",
  "hold.dependency": "{open} の完了を待っています",
  "hold.dependency-cancelled":
    "{cancelled} が取り消されたので、{task} を始められません。閉じるか、計画し直してください",
  "hold.branch-exists": "{branch} が {repository} にすでにあります",
  "hold.branch-deleted": "{branch} がマージされずに消されました",
  "hold.no-progress": "{attempts} 回試しても進みませんでした（{failure}）",
  "hold.prepare-failed": "prepare が失敗しました。{command} が {code} で終わりました",
  "hold.refs-moved": "run がタスクのブランチの外の ref を動かしました（{refs}）",
  "hold.run-failed": "run が {outcome}",
  "hold.blocked": "{blocked}: {question}",
  "hold.codemod-failed": "codemod {codemod} が {code} で終わりました",
  "hold.gates-misconfigured": "{level} の gate が MISCONFIGURED です（{reason}）",
  "hold.prove-misconfigured": "prove が MISCONFIGURED です（{reason}）",
  "hold.diff-guard": "diff-guard が差分を拒みました（{line}）",
  "hold.review-failed": "review が失敗しました（{error}）",
  "hold.review-escalated": "review が判断を人に回しました（{details}）",
  "hold.review-revisions": "review が {revisions} 回やり直したあとも修正を求めました（{details}）",
  "hold.verify-failed": "verify で確認に失敗しました（{summary}）",
  "hold.verify-not-run": "verify を実行できませんでした（{error}）",
  "hold.verify-unchecked": "verify が変更を確かめられませんでした（{summary}）",
  "hold.final-verification": "{fixes} 回直したあとも、最後の確認に失敗しました（{failure}）",
  "hold.draft-failed": "{agent} が {outcome}",
  "hold.draft-refused": "kozod が計画の下書きを 2 回拒みました（{issues}）",
  "hold.defect": "{defect}。kozo retry でもう一度確かめます",
  "hold.close-refused.complete":
    "{closer} が Issue を閉じましたが、完了にする権限がありません。kozo close で決めてください",
  "hold.close-refused.cancel":
    "{closer} が Issue を閉じましたが、取り消す権限がありません。kozo close で決めてください",
  "hold.untrusted-edit":
    "書き込み権限のない {author} が、作業の開始後に依頼を編集しました。kozo retry で新しい本文を取り込みます",
  "hold.pull-closed": "{url} がマージされずに閉じられました",
  "hold.diverged":
    "GitHub の {branch} が {head} の上にありません。kozo retry で kozod のコミットから続けます",
  "hold.ci-failed": "{fixes} 回直したあとも CI が失敗しました（{checks}）",
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
