---
title: CLI
description: kozo のすべてのコマンドとフラグを、使う場面ごとにまとめました。reference、終了コード、例も載せています。
---

`kozo` は kozo のコマンドラインです。状態を持たず、ほとんどのコマンドは kozod の local API を呼ぶので、先に `kozo up` で kozod を起動しておきます。`kozo check`、`kozo admin init`、local モードの `kozo admin install`、`kozo admin eval run` と検証のコマンドは、kozod なしで動きます。`kozo` を引数なしで実行すると、このページと同じ一覧を表示します。

## reference と終了コード

コマンドは、対象を reference で指定します。

| 対象 | reference                                        | 例               |
| ---- | ------------------------------------------------ | ---------------- |
| item | `K-<n>`。GitHub の Issue なら `<repository>#<n>` | `K-3`、`shop#42` |
| task | `<item>/t<n>`                                    | `K-3/t1`         |
| run  | `r-<nnnn>`                                       | `r-0042`         |

どのコマンドも次のいずれかの終了コードで終わるので、スクリプトで結果を見分けられます。

| コード | 意味                                            |
| ------ | ----------------------------------------------- |
| 0      | 成功                                            |
| 1      | 失敗                                            |
| 2      | 使い方の誤り                                    |
| 3      | 対象が人を待っている（L1 で追加した item など） |
| 4      | 見つからない                                    |

ほとんどのコマンドは `--json` を受け付け、そのときはテキストの代わりに JSON を 1 つ出力します。その `message` か `error` は factory の `locale` の文章で、スクリプト向けに `code` と `values` が隣に付きます。`kozo --version` はバージョンを表示します。

## kozod を動かす

### `kozo up` / `kozo down`

```sh
kozo up [--json]
kozo down [--json]
```

`up` は kozod をバックグラウンドで起動し、応答するまで待ちます。ログは `~/.kozo/kozod.log` に書かれます。`down` は kozod を止めます。動いている run も一緒に止まり、次に `up` したときに最後のチェックポイントから続きます。

### `kozo status`

```sh
kozo status [--line] [--json]
```

kozod の状態、モード、動いている run、inbox の件数、今日の費用を表示します。`--line` は、ステータスバー用に 1 行で表示します。

### `kozo dashboard`

```sh
kozo dashboard [--url] [--json]
```

[ダッシュボード](../dashboard/) をブラウザで開きます。`--url` は、開く代わりに URL を表示します。その URL でセッションを開けるのは 1 回だけで、有効なのは 1 分です。

## 作業を追加する・並べ替える

### `kozo add`

```sh
kozo add <text> [--repo <path>] [--class <class>] [-f <file>] [--json]
```

item を追加します。`<text>` の 1 行目がタイトルになり、残りの行と `-f` で渡したファイルの中身が本文になります。

| フラグ            | 意味                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `--repo <path>`   | `factory.yml` に登録したリポジトリ。複数登録しているときは必須です。                                                                |
| `--class <class>` | work class。`docs`、`deps`、`bugfix`、`refactor`、`perf`、`migration`、`feature` のいずれかです。指定しなければ triage が決めます。 |
| `-f <file>`       | ファイルの中身を本文に足します。                                                                                                    |

```sh
kozo add "Update the date library" --class deps
kozo add "Fix the login redirect" -f notes/login.md --repo ~/src/shop
```

### `kozo reorder`

```sh
kozo reorder <item> [--before <item>]
```

kozod が作業を始める順番の中で、item を別の item の前に動かします。`--before` を付けなければ最後に動かします。誰も動かさない限り、item は届いた順に始まります。

### `kozo issue`

```sh
kozo issue <item>
```

GitHub モードで、まだタスクのないローカルの item を、そのリポジトリの Issue に移します。ローカルの item は取り消され、kozod がその Issue を新しい item として取り込みます。

## 状況を読む

### `kozo ls`

```sh
kozo ls [inbox|items|tasks|runs] [--json]
```

あなたを待っているものを古い順に並べます。引数を付けると、すべての item、task、run を並べます。

### `kozo show`

```sh
kozo show <ref> [-f] [--diff] [--json]
```

item、task、run を表示します。計画の承認を待っている item では、下書きの計画を表示します。中身は、work class、risk tier、方針、各タスクの目的と、タスクが実行する codemod です。

| フラグ   | 意味                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| `-f`     | 対象の直近 400 件の event を表示し、そのあとも起きるそばから表示し続けます。 |
| `--diff` | タスクの、デフォルトブランチに対する差分を表示します。                       |

### `kozo report`

```sh
kozo report [--days <n>] [--review | --cost] [--json]
```

直近 `<n>` 日（既定は 30 日）の指標と失敗、昇格の提案を表示します。`--review` は、class ごとの自律度、引き下げ、費用を足します。`--cost` は、日ごとの費用を 1 日の予算と並べて表示します。

## 答える・決める

### `kozo approve` / `kozo reject`

```sh
kozo approve <item> [text]
kozo reject <item> <reason>
```

`approve` は、item が待っている開始か計画を承認します。テキストを付けると、次のエージェントへのメモになります。`reject` は理由を付けて計画を差し戻し、plan エージェントが書き直します。2 回差し戻された計画は、あなたの対応待ち（attention）になります。

### `kozo say`

```sh
kozo say <ref> <text>
kozo say --ask <ref> <question>
```

item や task が待っている質問に答えます。答えを待っているものがなければ、テキストは指示になります。動いている run には次のターンで届き、その item や task の以降の run にも渡ります。

`--ask` を付けると、explorer エージェントが記録をもとに item、task、run についての質問に答えます。作業には触れません。

```sh
kozo say K-3 "Use the existing date helper in src/lib/date.ts"
kozo say --ask K-3/t1 "Why did review ask for a revision?"
```

### `kozo retry`

```sh
kozo retry <ref> [text]
```

attention か question の hold を外して、やり直します。task は最後のチェックポイントから、item は計画からやり直します。テキストを付けると、次の run への指示になります。修正の回数を使い切って Handoff で止まったタスクは、回数を戻したうえで Building に戻ります。

### `kozo close`

```sh
kozo close <ref> --done
kozo close <ref> --cancel <reason>
```

変更が要らなかった item や task を完了にするか、理由を付けて取り消します。タスクを取り消すと、そのブランチも消えます。

## 止める・自分で作業する

### `kozo pause` / `kozo resume`

```sh
kozo pause [ref] [--now]
kozo resume [ref]
```

reference を付けなければ、ファクトリー全体を止めるか再開します。止めている間は新しい作業を始めず、動いている run は最後まで続きます。reference を付けると、その item、task、run を止めます。止まるのは次のノードで、`--now` を付ければすぐに止まります。

### `kozo take` / `kozo return`

```sh
kozo take <task>
kozo return <task> <text>
```

`take` はタスクをあなたに渡します。run は止まり、あなたはそのタスクの worktree で、タスクブランチにコミットします。worktree とブランチは、コマンドが表示します。`return` は、作業をコミットし、worktree をタスクブランチに戻してから、タスクを返します。テキストには、何を変えて何を確かめたかを書きます。そのあとタスクは、あなたのコミットに対して、決定的な確認から順にすべての確認をやり直します。

## 準備する

### `kozo check`

```sh
kozo check [path] [--json]
```

factory definition、各リポジトリの Charter・constraints・verify-app、`claude` とそのフラグとサインイン、GitHub モードなら gh のサインイン、sandbox を確かめます。パスを指定すると、そこにある factory definition か `.kozo/` ディレクトリだけを確かめます。リポジトリの CI ではこの形を使います。

### `kozo admin`

```sh
kozo admin init [--json]
kozo admin install <path> [--json]
kozo admin db-rebuild
kozo admin eval add <run> [--json]
kozo admin eval run [<case>...] [--json]
kozo admin prune --older-than <days> [--dry-run] [--json]
```

| コマンド                    | すること                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                      | kozo のテンプレートから `~/.kozo/factory` に factory definition を作り、コミットします。                                                                               |
| `install <path>`            | リポジトリに kozo のファイルを追加します。GitHub モードでは、代わりに kozod がそれを pull request で開きます。                                                         |
| `db-rebuild`                | event log から `kozo.db` を作り直します。                                                                                                                              |
| `eval add <run>`            | run の item から、factory definition の `evals/` に eval のケースの下書きを作ります。                                                                                  |
| `eval run [<case>...]`      | すべてのケース、または指定したケースを、それぞれ使い捨てのファクトリーのホームで実行します。期待した結果になった割合と、かかった費用を表示します。                     |
| `prune --older-than <days>` | item が閉じてから指定した日数以上たったすべての run について、event log、run report、判定、decision log を残してほかを消します。`--dry-run` は一覧を表示するだけです。 |

## 検証のコマンド

kozod は、各タスクでこれらを実行します。worktree やクローンの中で、手で実行することもできます。kozod は要りません。`--base` と `--head` に続く `<ref>` は、完全なコミット ID、`HEAD`、`refs/remotes/origin/main` のような完全な ref、またはブランチ名です。

| コマンド                                                          | 層  | すること                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kozo gates [--level fast\|full\|deep] [--base <ref>]`            | V1  | 1 つの水準の gate を実行します。既定は `full` です。`--base` を付けると、constraints を worktree ではなくその ref の先端から読みます。                                                                                              |
| `kozo diff-guard --base <ref> [--head <ref>] [--scope <glob>]...` | V2  | `<ref>` とのマージベースから `--head`（既定は `HEAD`）までの差分を、`<ref>` の先端にある Charter と constraints に照らして確かめます。                                                                                              |
| `kozo prove --base <ref> [--preserve]`                            | V3  | 変えたテストが、`HEAD` では通り、テスト以外の変更を戻すと失敗することを求めます。`--preserve` を付けると、振る舞いを変えない変更向けに、戻しても通り続けることを求めます。worktree に、コミットしていない変更があってはいけません。 |
| `kozo review --base <ref> --goal <text> --done-when <text>...`    | V4  | 差分、目的、条件、`--base` の時点のリポジトリの AGENTS.md だけを見る別の `claude` のセッションで、差分を判定します。                                                                                                                |
| `kozo verify --base <ref> --goal <text> --done-when <text>...`    | V5  | sandbox の中の `claude` のセッションで、`.kozo/verify-app.md` の手順でアプリを動かし、各条件を確かめます。                                                                                                                          |

`review` と `verify` は、`--model <id>`、`--max-cost <usd>`、`--out <dir>` も受け付けます。`--out` は、判定と、`verify` なら証拠も、そのディレクトリに残します。検証のコマンドはどれも `--json` を受け付けます。
