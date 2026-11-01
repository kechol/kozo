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
  "stage.no-start-approval": "自律度が開始の承認を求めていません",
  "stage.approve": "kozo approve",
  "stage.retry": "kozo retry",
  "stage.return": "kozo return",
  "stage.done": "kozo close --done",
  "stage.cancel": "kozo close --cancel（{reason}）",
  "stage.plan-always": "依頼者が信頼できないので、計画にはいつも承認が要ります",
  "stage.plan-level": "{level} では計画の承認が要ります",
  "stage.plan-feature": "{why}。plan エージェントが先に、受け入れ条件をあなたと詰めます",
  "stage.human-commit": "人が {branch} にコミットしました",
  "stage.split-again":
    "{task} は scope の中で終わらないので、item を切り分け直します（{question}）",
  "stage.merged": "{branch} にマージされ、そこで {level} の gate が通りました",
  "stage.merged-failed": "{branch} にマージされましたが、そこで {level} の gate が失敗しました",
  "stage.defect": "マージ後の確認に失敗しました（マージ後の不具合）",
  "stage.complete": "すべてのタスクが完了しました",
  "stage.checks-passed": "risk tier {risk} の確認を通りました",
  "stage.ready": "risk tier に応じた確認を通りました",
  "stage.review-revise": "review が修正を求めました（{summary}）",
  "stage.verify-unmet": "verify で、満たされていない DONE_WHEN が見つかりました（{summary}）",
  "stage.conflict": "差分が最新の {branch} と衝突しました（{error}）",
  "stage.deep-failed": "{branch} に rebase したあと、deep の gate が失敗しました",
  "stage.moved-to-issue": "{issue} に移しました",
  "stage.issue-closed": "Issue が {reason} として閉じられました",
  "stage.changes-requested": "{author} が {url} で変更を求めました",
  "stage.ci-failed": "CI が失敗しました（{checks}）",
  "run.closed": "タスクが閉じられました",
  "run.held": "タスクに hold があります",
  "run.kozod-stopped": "kozod が止まりました",
  "run.human-stopped": "人が止めました",
  "run.interrupted": "run の途中で kozod が止まりました",
  "run.unfinished": "kozod が最後まで進められませんでした（{error}）",
  "run.prepare-failed": "prepare が失敗しました",
  "run.refs-moved": "タスクのブランチの外の ref が動きました",
  "run.codemod-failed": "codemod が失敗しました",
  "run.gates-misconfigured": "gate の設定が誤っています",
  "run.prove-misconfigured": "prove の設定が誤っています",
  "run.diff-guard": "diff-guard が差分を拒みました",
  "run.review-failed": "review が失敗しました",
  "run.verify-not-run": "verify を実行できませんでした",
  "run.no-verify-app": "verify-app.md がありません",
  "run.final-verification": "最後の確認に失敗しました",
  "run.draft-refused": "kozod が計画の下書きを拒みました",
  "run.answer-invalid": "回答がスキーマに合いません",
  "run.report-invalid": "run report がスキーマに合いません",
  "run.uncommitted": "run がコミットしていない変更を残しました（{files}）",
  "run.characterize-changed":
    "このタスクは振る舞いを記録するだけなので、差分はテストファイルだけのはずですが、{file} を変えています",
  "run.characterize-no-test":
    "このタスクは振る舞いを記録するものですが、差分に、constraints の prove が実行するテストがありません",
  "run.gate-failed": "gate {gate} が失敗しました",
  "run.prove-failed": "{line}",
  "session.lost": "{agent} のワーカーが失われました",
  "session.timed-out": "{agent} が時間切れになりました",
  "session.stopped": "{agent} が止められました",
  "session.failed": "{agent} が失敗しました（{reason}）",
  "session.answered": "{agent} が回答しました",
  "session.no-diff": "review する差分がありません",
  "session.accept-blocking": "review が、blocking の指摘があるのに差分を受け入れました",
  "session.conditions-count":
    "verify の回答が扱った条件は {count} 件で、渡した {expected} 件と違います",
  "session.condition-order":
    "verify の回答の {index} 番目の条件が、DONE_WHEN の {index} 番目の条件と違います",
  "session.pass-unmet": "verify の回答が、満たされていない条件があるのに pass としました",
  "session.no-evidence": "verify の回答が、{index} 番目の条件を証拠なしで満たしたとしました",
  "session.not-cleaned": "verify の回答が、アプリの後片付けをせずに pass としました",
  "session.verdict-inside": "判定のディレクトリは worktree の外に置く必要があります",
  "session.evidence-changed": "証拠のファイル {path} がコピーの途中で変わりました",
  "session.evidence-missing": "証拠のファイル {path} がありません",
  "session.evidence-outside": "証拠のファイル {path} が worktree の外にあります",
  "session.evidence-not-file":
    "証拠のファイル {path} が、リンクが 1 つだけの通常のファイルではありません",
  "session.schema": "{name} の回答がスキーマに合いません（{issues}）",
  "session.ended": "セッションが {subtype} で終わりました",
  "session.no-result": "セッションが結果を返さずに終わりました",
  "session.failed-error": "セッションが失敗しました（{error}）",
  "node.failure": "{reason}\n{details}",
  "node.exited": "{command} が {code} で終わりました",
  "node.prepared": "準備済みです",
  "node.refs-moved": "タスクのブランチの外の ref が動きました（{refs}）",
  "node.stopped": "止まりました",
  "node.split-again": "scope で止まったので、item を切り分け直します",
  "node.blocked": "止まりました（{reason}）",
  "node.codemod-exited": "codemod が {code} で終わりました",
  "node.gates-misconfigured": "gate が MISCONFIGURED です（{reason}）",
  "node.verdict": "{verdict}: {summary}",
  "node.skipped-low": "risk tier が low なので飛ばしました",
  "node.skipped-no-verify-app": "リポジトリに verify-app.md がないので飛ばしました",
  "node.discarded": "{summary}。kozod が、worktree に残されたものを捨てました（{files}）",
  "node.verified": "{head} を確かめました",
  "note.ci-failed": "CI のチェック {checks} が {head} で失敗しました。",
  "note.check-failed":
    "マージのあと、{branch} で {level} の gate が失敗したので、DONE_WHEN を満たしていません。\n{output}",
  "note.changes-requested": "{author} が変更を求めました",
  "defect.gates": "マージのあと、{branch} で {level} の gate が失敗しました",
  "risk.code-change": "差分が、ドキュメントではない {file} を変えています",
  "factory.pause": "kozo pause",
  "factory.resume": "kozo resume",
  "factory.api-failures": "API で 3 回続けてセッションが失敗しました（最後の理由: {reason}）",
  "factory.paused-label": "{login} が {ref} に kozo:paused を付けました",
  "demotion.defect": "{task} でマージ後の不具合が見つかりました",
  "demotion.intervention":
    "直近 {recent} 件のマージ済みの差分のうち、{intervened} 件に人の手が入りました",
  "guard.not-text": "パスが文字列ではありません",
  "guard.outside": "{path} は worktree の外にあります",
  "guard.symlink": "{path} はシンボリックリンクを経由しています",
  "guard.hard-link": "{path} にはハードリンクが 2 つ以上あります",
  "guard.protected": "{path} は保護されたパスです。変える必要があれば kozo_blocked で質問します",
  "guard.out-of-scope": "{path} はタスクの scope（{scope}）の外にあります",
  "guard.existing-test": "{path} は既存のテストで、このリポジトリではタスクが変えられません",
  "guard.command": "{name}: {why}",
  "guard.git": "git {name}: {why}",
  "guard.why.github": "GitHub に触れるのはファクトリーだけです",
  "guard.why.forge": "フォージに触れるのはファクトリーだけです",
  "guard.why.own-user": "コマンドはワーカー自身のユーザーで動きます",
  "guard.why.alias": "エイリアスは、あとのコマンドが実行するものを隠してしまいます",
  "guard.why.keeps-running": "コマンドが終わったあとに動き続けるものは許されません",
  "guard.why.scheduled": "run の外で予定を組むことは許されません",
  "guard.why.started": "run の外で何かを起動することは許されません",
  "guard.why.outside-sandbox": "sandbox の外で動きます",
  "guard.why.network": "run は、このマシンの外のネットワークに出られません",
  "guard.why.gates": "gate は kozo_gates のツールで実行します",
  "guard.why.push": "push するのは kozod だけです",
  "guard.why.pull": "タスクのブランチは、kozod が選んだデフォルトブランチから始まります",
  "guard.why.merge": "マージは人が行います",
  "guard.why.ref": "run が変えられるのはタスクのブランチだけです",
  "guard.why.switch": "run はタスクのブランチにとどまります",
  "guard.why.history": "タスクのブランチの外の履歴は、run のものではありません",
  "guard.why.submodule": "サブモジュールは、リポジトリがチェックアウトするものを変えます",
  "guard.why.bisect": "HEAD をタスクのブランチから動かします",
  "guard.git-config": "git -c と --config-env は、そのコマンドの git の設定を変えてしまいます",
  "guard.git-elsewhere": "git {option} は、git に worktree 以外の場所を指させてしまいます",
  "guard.git-c-dir": "git -C には worktree の中のディレクトリを指定します",
  "guard.git-dynamic-subcommand": "展開から組み立てた git のサブコマンドです",
  "guard.git-dynamic-argument": "git {name}: 展開から組み立てた引数です",
  "guard.git-stash": "git stash: run は変更を worktree に残します。コミットするか、編集を続けます",
  "guard.git-pager": "git grep --open-files-in-pager は別のプログラムを実行します",
  "guard.git-changes": "git {command} は ref か設定を変えてしまいます",
  "guard.git-unlisted": "git {name} は、run が使えるコマンドではありません",
  "guard.too-deep": "コマンドの入れ子が深すぎて確かめられません",
  "guard.unparsed": "コマンドを解析できません（{error}）",
  "guard.background":
    "バックグラウンドのジョブは、この確認のあとでファイルを変えるおそれがあります",
  "guard.script-outside": "{how} {path}: 実行できるのは worktree の中のスクリプトだけです",
  "guard.script-alone": "{path} は、それだけの Bash の呼び出しで実行します",
  "guard.redirect-git": "{name} は git の向き先を変えてしまいます",
  "guard.dynamic-command": "展開から組み立てたコマンド名です",
  "guard.filled-command": "find か xargs が埋めるコマンド名です",
  "guard.xargs": "xargs {target}: xargs は、guard が読まない入力から引数を足します",
  "guard.dynamic-eval": "展開から組み立てた文字列の eval です",
  "guard.dynamic-path": "展開から組み立てたパスの {name} です",
  "guard.dynamic-script": "展開から組み立てたスクリプトの {name} -c です",
  "guard.dynamic-script-path": "展開から組み立てたスクリプトのパスを使う {name} です",
  "guard.piped-script": "スクリプトをパイプから読む {name} です",
  "guard.pattern-outside": "パターンが worktree の外に届いています",
  "guard.command-not-text": "コマンドが文字列ではありません",
  "guard.tool": "{tool} は、run が使えるツールではありません",
  "guard.wrapper-dynamic": "展開から組み立てた引数を持つ {name} です",
  "guard.wrapper-option": "{name} {option}: guard が知らないオプションです",
  "guard.wrapper-no-value": "{name} {flag} に値がありません",
  "guard.wrapper-dynamic-value": "展開から組み立てた値を持つ {name} {flag} です",
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
  "api.no-repository": "リポジトリが登録されていません。factory/factory.yml に追加してください",
  "api.name-repository": "リポジトリを指定してください（{repositories}）",
  "api.unregistered": "{repository} は登録されたリポジトリではありません",
  "api.not-accepted": "受け付けられません（{reason}）",
  "api.duplicate": "{ref} がすでに同じことを依頼しています",
  "api.added": "{ref} を追加しました。Triage に進みます",
  "api.added-waiting": "{ref} を追加しました。開始の承認を待っています",
  "api.issue-local": "kozo issue で item を移せるのは GitHub モードだけです",
  "api.missing": "{ref} はありません",
  "api.no-approval": "{ref} は承認を待っていません",
  "api.approved-start": "{ref} の開始を承認しました。Triage に進みます",
  "api.no-plan": "{ref} には承認する計画がありません",
  "api.approved-plan": "{ref} の計画を承認しました。{count} 件のタスクが Building に進みます",
  "api.no-plan-approval": "{ref} は計画の承認を待っていません",
  "api.rejected-twice": "{ref} の計画を 2 回目に差し戻しました。あなたの対応を待っています",
  "api.rejected":
    "{ref} の計画を差し戻しました。plan エージェントが、あなたの理由をもとに下書きし直します",
  "api.explorer-stopped": "kozod が質問に答えられるのは、動いている間だけです",
  "api.budget-spent": "1 日の予算 {budget} USD を使い切りました。明日もう一度尋ねてください",
  "api.answered": "{ref} に答えました。作業を再開します",
  "api.sent": "{run} に送りました。次のターンで読みます",
  "api.noted": "{ref} の次の run のために記録しました",
  "api.already-paused": "{ref} はすでに止まっています",
  "api.closed": "{ref} は {stage} です",
  "api.held-until": "{ref} には {hold} の hold があり、それが外れるまで動きません",
  "api.paused-stopped": "{ref} を止め、{run} を停止しました",
  "api.paused": "{ref} を止めました。次のノードで止まります",
  "api.yours": "{ref} はあなたが引き取っています。kozo return で返します",
  "api.not-paused": "{ref} は止まっていません",
  "api.resumed": "{ref} を再開しました",
  "api.held": "{ref} には {hold} の hold があります",
  "api.retry-building": "{ref} を、修正の回数を戻して Building からやり直します",
  "api.retry-checkpoint": "{ref} を最後のチェックポイントからやり直します",
  "api.retry-plan": "{ref} を計画からやり直します",
  "api.already-yours": "{ref} はすでにあなたが引き取っています",
  "api.no-worktree": "{ref} にはまだ worktree がありません。最初の run が作ります",
  "api.taken":
    "{ref} を引き取りました。{worktree} の {branch} にコミットしてから、kozo return {ref} <変えたことと確かめたこと> を実行してください",
  "api.not-taken": "{ref} は引き取られていません。kozo take で引き取れます",
  "api.uncommitted": "{worktree} にコミットしていない変更があります。先にコミットしてください",
  "api.wrong-branch": "{worktree} が {branch} にありません。先に戻してください",
  "api.returned": "{ref} を返しました。あなたのコミットに対して確認を実行します",
  "api.before-itself": "{ref} を自分自身の前には動かせません",
  "api.already-there": "{ref} はすでにその位置にあります",
  "api.moved-before": "{ref} を {before} の前に動かしました",
  "api.moved-end": "{ref} を最後に動かしました",
  "api.already-closed": "{ref} はすでに {stage} です",
  "api.closed-done": "{ref} を完了として閉じました",
  "api.cancelled": "{ref} を取り消しました（{reason}）",
  "api.factory-already-paused": "ファクトリーはすでに止まっています",
  "api.factory-paused": "ファクトリーを止めました。新しい作業は始まりません",
  "api.factory-not-paused": "ファクトリーは止まっていません",
  "api.factory-resumed": "ファクトリーを再開しました",
  "api.not-github": "{path} は登録された GitHub のリポジトリではありません",
  "api.install-waits": "導入の pull request がレビューとマージを待っています（{url}）",
  "api.install-complete": "{repository} には、kozo が入れるファイルがすべてあります",
  "api.install-opened":
    "{url} を開きました。ファイルを編集して status: ready にしてから、マージしてください",
  "api.not-local": "{ref} はローカルの item ではありません",
  "api.has-tasks": "{ref} にはすでにタスクがあり、その作業は移せません",
  "api.no-github": "factory.yml で、{repository} に GitHub のリポジトリが指定されていません",
  "api.moved-issue": "{ref} を {issue} に移しました。kozod が {item} として取り込みます",
  "api.no-outcome": "{ref} は、eval のケースが期待できる結果にまだ達していません",
  "api.no-start-run": "{ref} には、始められる run がありません",
  "api.rebuilt": "event log から kozo.db を作り直しました",
  "api.install-local": "local モードでは、kozo admin install が自分でファイルを書きます",
  "api.drafted": "{run} から evals/{id}.yml を下書きしました",
  "api.prune-none": "{date} より前に閉じた item の run に、整理する記録はありません",
  "api.prune-would": "{date} より前に閉じた item の run を {count} 件整理します（{runs}）",
  "api.pruned": "{date} より前に閉じた item の run を {count} 件、log と判定だけに整理しました",
  "api.unknown-host": "知らないホストです",
  "api.hello-nonce": "hello には 16 進数の nonce が要ります",
  "api.session-origin": "セッションを渡すのは、ダッシュボード自身の origin だけです",
  "api.code-invalid": "コードが不明か、使用済みか、期限切れです",
  "api.token": "API token がないか、誤っています",
  "api.code-token": "ダッシュボードのコードを求められるのは API token だけです",
  "api.write-origin": "書き込みを受け付けるのは、このマシン自身の origin からだけです",
  "api.not-json": "本文が JSON ではありません",
  "api.no-view": "レポートの表示 {view} はありません",
  "api.days": "days は 1 から {max} までの整数にします",
  "api.unknown-list": "一覧 {list} はありません",
  "api.not-reference": "{ref} は reference ではありません",
  "api.diff-task": "差分があるのはタスクだけです",
  "api.no-diff": "{ref} には差分がありません",
  "api.no-branch": "{ref} にはまだブランチがありません",
  "api.records-task": "記録があるのはタスクだけです",
  "api.not-run": "{run} は run ではありません",
  "api.no-evidence": "その証拠はありません",
  "api.unknown-verb": "操作 {verb} はありません",
  "api.verb-kind": "{kind} は {verb} を受け付けません",
  "api.invalid-install": "install の内容が正しくありません",
  "api.invalid-eval": "eval のケースの内容が正しくありません",
  "api.invalid-prune": "prune の内容が正しくありません",
  "api.no-endpoint": "そのエンドポイントはありません",
  "api.invalid-item": "item の内容が正しくありません",
  "api.invalid-verb": "{verb} の内容が正しくありません",
  "cli.usage": `使い方: kozo <command>

コマンド:
  up | down [--json]
      kozod をバックグラウンドで起動、または停止します
  status [--line] [--json]
      kozod の状態、モード、run、inbox の件数、今日の費用を表示します。
      --line はステータスバー向けに 1 行で表示します
  add <text> [--repo <path>] [--class <class>] [-f <file>] [--json]
      item を追加します。1 行目がタイトル、残りとファイルの内容が本文です
  ls [inbox|items|tasks|runs] [--json]
      人を待っているもの（既定）、またはすべての item、タスク、run を一覧します
  show <ref> [-f] [--diff] [--json]
      item、タスク、run を表示します。-f はイベントを追い続け、--diff は
      タスクの差分をデフォルトブランチと比べて表示します
  say <ref> <text>          質問に答える、または run やタスクに指示します
  say --ask <ref> <question>
      item、タスク、run について尋ねます。explorer が作業に触れず、
      記録から答えます
  approve <item> [text]     開始または計画を承認します
  reject <item> <reason>    計画を差し戻します
  pause [ref] [--now] | resume [ref]
      ファクトリー全体、または 1 つの item、タスク、run を止める、または再開します
  retry <ref> [text]        タスクをチェックポイントから、または item を再試行します
  close <ref> --done | --cancel <reason>
      変更が要らなかった item やタスクを完了にする、または取り消します
  reorder <item> [--before <item>]
      kozod が作業を始める順で、item を別の item の前、または最後に移します
  issue <item>              GitHub モードで、タスクのない ローカルの item を
      リポジトリの Issue に移します。以降は kozod が引き取ります
  take <task>               タスクを引き取り、その worktree で作業します
  return <task> <text>      引き取ったタスクを、作業をコミットしてから返します。
      返すと、決定的なチェックから順に、あなたのコミットに対して実行されます
  report [--days <n>] [--review | --cost] [--json]
      直近 <n> 日（既定は 30）の指標と失敗、昇格の提案を表示します。
      --review は class ごとのレベル、降格、費用を加え、--cost は日ごとの
      費用を予算と並べて表示します
  dashboard [--url] [--json]
      ダッシュボードをブラウザで開きます。--url は URL だけを表示します。
      URL でセッションを開けるのは、1 分以内の 1 回だけです
  check [path] [--json]
      factory definition、各リポジトリの Charter、claude、sandbox を確認します。
      path を渡すと、そのディレクトリの definition か .kozo/ だけを確認します
  admin init [--json]       kozo のテンプレートから factory definition を作ります
  admin install <path> [--json]
      kozo のファイルをリポジトリに追加します。GitHub モードでは、kozod が
      pull request として開きます
  admin db-rebuild          イベントログから kozo.db を作り直します
  admin eval add <run> [--json]
      run の item の eval ケースを、factory definition の evals/ に下書きします
  admin eval run [<case>...] [--json]
      eval ケース（指定があればそれだけ）を、それぞれ使い捨てのファクトリーのホームで
      実行し、期待した結果に届いた割合と費用を表示します
  admin prune --older-than <days> [--dry-run] [--json]
      item が <days> 日以上前に閉じた run から、イベントログ、report、verdict、
      decision log 以外を削除します

  gates [--level fast|full|deep] [--base <ref>] [--json]
      1 つのレベル（既定は full）の gate を実行します。--base を付けると、
      constraints を worktree ではなく <ref> の先頭から取ります
  diff-guard --base <ref> [--head <ref>] [--scope <glob>]... [--json]
      <ref> とのマージベースから <head>（既定は HEAD）までの差分を、
      <ref> の先頭にある Charter と constraints に照らして確認します
  prove --base <ref> [--preserve] [--json]
      変更したテストが HEAD で通り、テスト以外の変更をその場で戻すと失敗する
      ことを求めます。--preserve は、振る舞いを変えない変更向けに、戻しても
      通ることを求めます。worktree はクリーンである必要があります
  review --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      <ref> とのマージベースから HEAD までの差分を、差分と GOAL、DONE_WHEN
      だけを見る別の claude セッションで審査します。--out を付けると、
      verdict を <dir>/verdict.json に記録します
  verify --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      <ref> の先頭で、.kozo/verify-app.md に従ってアプリを sandbox 内の claude
      セッションで動かし、DONE_WHEN の各条件を試します。--out を付けると、
      verdict を記録し、証拠を <dir> にコピーします

オプション:
  --version  バージョンを表示します

item の <ref> は K-<n> か <repo>#<n>、タスクは <item>/t<n>、run は r-<nnnn> です。
終了コードは、0 が成功、1 が失敗、2 が使い方の誤り、3 が人を待っている、
4 が見つからない、です。

--base と --head の <ref> には、完全なコミット ID、HEAD、refs/remotes/origin/main
のような完全な ref、またはブランチ名（refs/heads/<name> として読みます）を
指定できます。`,
  "cli.unknown-command": "コマンド '{command}' はありません",
  "cli.unknown-gate-level": "gate のレベル '{level}' はありません",
  "cli.needs-base": "{command} には --base <ref> が必要です",
  "cli.needs-session-options":
    "{command} には --base <ref>、--goal <text> と、1 つ以上の --done-when <text> が必要です",
  "cli.max-cost": "--max-cost には 0 より大きい USD の金額を指定してください",
  "cli.needs-claude": "{command} には PATH 上の claude CLI が必要です",
  "cli.condition-met": "達成",
  "cli.condition-not-met": "未達",
  "cli.kozod-not-installed":
    "kozo の隣にも PATH 上にも kozod がありません。KOZOD に kozod のパスを設定してください",
  "cli.kozod-unreachable": "kozod が動いていません。kozo up で起動してください",
  "cli.kozod-timeout": "kozod が {seconds} 秒以内に応答しませんでした",
  "cli.kozod-foreign":
    "{base} のサーバーはこのホームの kozod ではないため、トークンは送っていません",
  "cli.kozod-never-ran":
    "このホームではまだ kozod が動いたことがありません。kozo up で起動してください",
  "cli.kozod-not-json": "kozod が {status} で JSON ではない応答を返しました",
  "cli.kozod-answered": "kozod が {status} を返しました",
  "cli.kozod-already-running": "kozod はすでに動いています",
  "cli.kozod-up": "kozod を起動しました",
  "cli.kozod-not-started": "kozod が起動しませんでした。{log} を確認してください",
  "cli.kozod-not-running": "kozod は動いていません",
  "cli.kozod-not-running-pid":
    "kozod は動いていません。{file} の pid {pid} は kozod ではありません",
  "cli.kozod-down": "kozod を停止しました",
  "cli.kozod-not-stopped": "kozod（pid {pid}）が 15 秒以内に止まりませんでした",
  "cli.opener-failed":
    "{opener} でブラウザを開けませんでした。kozo dashboard --url を実行してください",
  "cli.dashboard-opened": "{url} でダッシュボードを開きました",
  "cli.status-down": "kozo: 停止中",
  "cli.status-line": "kozo: {state} {mode} · {running} · {waiting} · {cost}",
  "cli.state-up": "稼働中",
  "cli.state-paused": "一時停止",
  "cli.kozod-state-running": "稼働中",
  "cli.kozod-state-paused": "一時停止中（{reason}）",
  "cli.count-running": "{count} 件実行中",
  "cli.count-waiting": "{count} 件待ち",
  "cli.count-in-inbox": "inbox に {count} 件",
  "cli.cost-today": "今日 {amount}",
  "cli.cost-today-held": "今日 {amount}、確保分 {held}",
  "cli.unknown-class": "work class '{class}' はありません",
  "cli.add-needs-text": "add には依頼の文章が必要です",
  "cli.unknown-list": "一覧 '{list}' はありません",
  "cli.nothing-in": "{list} には何もありません",
  "cli.awaiting-merge": "マージ待ち",
  "cli.show-needs-ref": "show には item、タスク、run の reference が必要です",
  "cli.diff-needs-task": "--diff にはタスクの reference が必要です",
  "cli.characterizes": "（characterize）",
  "cli.draft-summary": "{class}、risk tier {risk}: {approach}",
  "cli.run-under": "{target}（{parent} の下）",
  "cli.needs-reference": "{verb} には reference が必要です",
  "cli.say-needs-text": "say には送る文章が必要です",
  "cli.reject-needs-reason": "reject には理由が必要です",
  "cli.close-needs-choice": "close には --done か --cancel <reason> が必要です",
  "cli.return-needs-text": "return には、変更した内容と確かめた内容が必要です",
  "cli.report-exclusive": "report で --review と --cost は同時に指定できません",
  "cli.report-days": "report の --days <n> には 1 から 365 の整数を指定してください",
  "cli.report-window": "直近 {days} 日で、マージした差分は {merged} 件",
  "cli.metric-autonomy": "{rate}  （70% 以上）",
  "cli.metric-defect": "{rate}  （5% 以下）",
  "cli.metric-cost": "{cost}  （中央値）",
  "cli.metric-time": "{time}  （中央値、24 h 以内）",
  "cli.metric-revise": "{reviews} 件のレビューのうち {rate}  （10% から 30%）",
  "cli.metric-held": "質問と対応待ちが {held} 件  （10 件以下）",
  "cli.no-failures": "期間内の失敗はありません",
  "cli.failures": "期間内の失敗（振り返り用）: {count} 件",
  "cli.promotions": "昇格の提案: Charter で L3 に上げる",
  "cli.class-in-repository": "{repository} の {class}",
  "cli.levels": "kozod が適用しているレベル",
  "cli.demotions": "降格（Charter が変わるまで）",
  "cli.demotion": "{place}: {from} から {to} へ、{reason}",
  "cli.cost-in-window": "期間内 {cost}",
  "cli.cost-of-budget": "{budget} のうち {today}",
  "cli.eval-add-takes-run": "admin eval add には run を 1 つ（r-<nnnn>）指定してください",
  "cli.eval-exists": "{path} はすでにあります。下書きし直すには削除してください",
  "cli.eval-wrote": "{path} を書きました。必要な隠しテストとチェックを足して、コミットしてください",
  "cli.eval-takes": "admin eval には add か run を指定してください",
  "cli.eval-no-results": "kozod --eval が結果を出力しませんでした",
  "cli.eval-expected": "期待は {expected}",
  "cli.eval-check-by-hand": "手で確認: {rule}",
  "cli.eval-summary": "{total} 件中 {passed} 件が期待した結果に届きました。費用は合計 {cost}",
  "cli.exited-with": "{command} が {code} で終了しました",
  "cli.install-takes-path": "admin install にはリポジトリのパスが必要です",
  "cli.prune-takes-days": "admin prune には --older-than <days>（日数の整数）が必要です",
  "cli.admin-takes":
    "admin には init、install、db-rebuild、prune、eval のいずれかを指定してください",
  "cli.install-nothing": "{path} には kozo が入れるファイルがすべてあります",
  "cli.installed":
    "{files} を {path} に追加しました。編集し、.kozo/charter.yml の status を ready にしてコミットしてください",
  "cli.init-not-empty": "{directory} が空ではありません。factory definition はすでにあります",
  "cli.init-commit-failed": "{directory} に書きましたが、コミットできませんでした（{error}）",
  "cli.init-created":
    "{directory} に factory definition を作りました。factory.yml にリポジトリを追加してコミットしてください",
  "cli.check-takes-path": "check に渡せるパスは 1 つまでです",
  "cli.check-neither":
    "factory definition（factory.yml、agents/）でも、.kozo/ のあるリポジトリでもありません",
  "cli.check-at-commit": "{where}（{commit}）",
  "cli.check-missing": "{path} がありません",
  "cli.check-charter-status":
    "status が {status} です。ready になるまで、kozo はここで作業しません",
  "cli.check-ready": "ready",
  "cli.check-valid": "正しい",
  "cli.check-verify-app-missing": "{path} がないため、verify は動きません",
  "cli.check-hooks-sdk": "worker が guard をコードで登録し、設定ファイルは読み込みません",
  "cli.check-hooks-cli":
    "claude は kozod が書く設定ファイルだけを読み込み、その hooks がすべてのツール呼び出しを worker の guard に渡します",
  "cli.check-name-flags": "claude のフラグ",
  "cli.check-name-sign-in": "claude のサインイン",
  "cli.check-name-gh": "gh のサインイン",
  "cli.check-claude-missing": "claude が PATH にありません",
  "cli.check-flags-ok": "kozo が使うフラグはすべてあります",
  "cli.check-flags-missing": "{flags} がありません。claude を更新してください",
  "cli.check-signed-in": "{method} でサインインしています",
  "cli.check-not-signed-in": "サインインしていません。claude auth login を実行してください",
  "cli.check-gh-missing": "gh が PATH にありません。GitHub モードは gh 経由で GitHub に接続します",
  "cli.check-gh-signed-in": "github.com に {login} としてサインインしています",
  "cli.check-gh-not-signed-in":
    "gh が github.com にサインインしていません。gh auth login を実行してください",
  "cli.check-confines": "{tool} が gate を閉じ込めます",
  "cli.check-lsof-ok": "セッションが残したプロセスを一覧できます",
  "cli.check-lsof-missing":
    "lsof が PATH にありません。kozod はセッションが残したものを止めるために必要とします",
  "cli.check-no-sandbox": "{platform} 用の sandbox はありません",
  "cli.check-missing-tools": "{tools} がありません",
  "hold-kind.approval": "承認",
  "hold-kind.question": "回答",
  "hold-kind.attention": "対応",
  "hold-kind.paused": "一時停止",
  "hold-kind.taken": "引き取り",
  "hold-kind.dependency": "依存先",
  "hold-kind.capacity": "空き",
  "github.status": "**kozo**: {item} は {stage} にあります。",
  "github.status-waiting": "**kozo**: {item} は {stage} にあり、{hold}を待っています（{reason}）。",
  "github.table": "| タスク | stage | pull request |",
  "github.task-waits": "{stage}（{hold}を待っています）",
  "github.cost": "ここまでの費用: {cost} USD",
  "github.question":
    "**{ref} についての質問:** {question}\n\nこのリポジトリに書き込める人は、ここへの返信で答えてください。`kozo say {ref} <answer>` でも答えられます。",
  "github.ready": "{task} のレビューとマージの準備ができました: {url}",
  "github.part-of": "#{issue} の一部です",
  "github.install-title": "kozo を導入する",
  "github.install-body":
    "このリポジトリで kozo が使うものを追加します。\n\n{files}\n\nマージする前に、`AGENTS.md` にリポジトリの説明を書き、`.kozo/constraints.yml` と `.kozo/verify-app.md` のコマンドをリポジトリのものに置き換え、`.kozo/charter.yml` のすべての設定を読んで `status` を `ready` にしてください。kozo がこのリポジトリで作業するのは、そのあとです。\n\nkozo はリポジトリの設定を変えません。`kozo check` を通る pull request からだけデフォルトブランチを変えられるようにするには、管理者がこの ruleset を適用します。\n\n```sh\ngh api --method POST repos/{repository}/rulesets --input - <<'EOF'\n{ruleset}\nEOF\n```",
  "github.label-stage": "kozo が示す stage",
  "github.label-needs": "kozo が人を待っています",
  "github.label-accept": "この Issue で kozo の開始を承認します",
  "github.label-paused": "kozo のファクトリーを止めます",
  "handoff.why": "## 理由",
  "handoff.task-of": "{title}（{count} 件中 {index} 件目のタスク）",
  "handoff.what": "## 変えたもの",
  "handoff.no-report": "（run report がありません）",
  "handoff.decisions": "判断:",
  "handoff.scope": "## 範囲外にしたもの",
  "handoff.nothing": "特にありません。",
  "handoff.safe": "## 安全と言える根拠",
  "handoff.prove-fail": "- prove: 変えたテストは、変更がないと失敗します（{tests}）",
  "handoff.prove-pass": "- prove: 変えたテストは、変更がなくても通ります（{tests}）",
  "handoff.review": "- review: {verdict}（{summary}）",
  "handoff.review-none": "- review: 記録なし",
  "handoff.verify": "- verify: {result}（{summary}）",
  "handoff.verify-none": "- verify: 実行していません",
  "handoff.verification": "## 確認の結果",
  "handoff.merge": "マージするには: git merge --no-ff {branch}",
  "issue.owner-name": "<owner>/<name> の形にします",
  "issue.kozo-label": "kozo: で始まるラベルは kozo のものです",
  "issue.github-required": "github モードでは GitHub のリポジトリを指定します",
  "issue.duplicate-repository": "ほかのリポジトリも {name} という名前です",
  "issue.worktree-only": "worktree を指定します。kozo の隔離の方法はこれだけです",
  "issue.gate-name": "英小文字、数字、- を使います",
  "issue.gate-once": "各 gate は 1 回だけ書きます",
  "issue.prove-files": "テストファイルを置く位置に {files} を書きます",
  "issue.gate-undefined": "gate「{name}」が gates にありません",
  "issue.blueprint-nodes":
    "すべてのノードを {nodes} の順に書きます。verify-app を実行するかどうかは risk tier が決めます",
  "issue.task-id": "t<n> の形にします",
  "issue.codemod-line": "codemod は、印字できる ASCII 文字の 1 行で書きます",
  "issue.task-twice": "タスク {id} が 2 回書かれています",
  "plan.too-many-tasks":
    "計画のタスクは {count} 件で、Charter の max_tasks_per_item（{limit}）を超えています",
  "plan.too-big":
    "{task} の見積もりは {files} ファイル {lines} 行で、Charter の上限（{maxFiles} ファイル {maxLines} 行）を超えています",
  "plan.cycle": "依存関係が循環しています（{cycle}）",
  "plan.shared-scope": "{a} と {b} は scope が重なっていますが、どちらも他方に依存していません",
  "plan.migration-after":
    "migration のタスクは順に 1 本の鎖になるので、{task} は {before} だけに依存します",
  "plan.migration-first":
    "migration のタスクは順に 1 本の鎖になるので、{task} はどのタスクにも依存しません",
  "plan.migration-start":
    "migration は振る舞いを記録するタスクから始まります。{task} で、migration が保つ振る舞いを固定するテストを足してください",
  "plan.characterize-codemod":
    "{task} は振る舞いを記録するタスクなので、テストを足すだけで codemod は実行しません",
  "plan.done-when":
    "item の DONE_WHEN の条件「{condition}」を、どのタスクの done_when も繰り返していません",
};
