---
title: constraints
description: .kozo/constraints.yml のすべてのキーと、変更を確かめるコマンド、そのコマンドが動く環境を説明します。
---

constraints（`.kozo/constraints.yml`）は、1 つのリポジトリで変更を確かめる方法を kozo に伝えます。gate、worktree を準備するコマンド、テストの見分け方が入ります。Charter と同じく、kozo はこれをデフォルトブランチの先端から読み、差分からは読みません。

```yaml
version: 1
services: ['docker compose up -d db']
teardown: ['docker compose down -v']
ports: 1
prepare: ['bun install --frozen-lockfile']
tests: ['**/*.test.*']
generated: ['bun.lock']
gates:
  lint:
    run: bun run check
  typecheck:
    run: bun run typecheck
  test:
    run: bun test
  e2e:
    run: bun run e2e
levels:
  fast: [lint, typecheck]
  full: [lint, typecheck, test]
  deep: [lint, typecheck, test, e2e]
prove:
  - files: ['**/*.test.ts']
    run: bun test {files}
```

## キー

| キー        | 既定値 | 意味                                                                                                        |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `version`   |        | いつも `1` です。                                                                                           |
| `services`  | `[]`   | gate に要るもののうち、kozo の sandbox では動かせないもの（データベースのコンテナなど）を起動するコマンド。 |
| `teardown`  | `[]`   | `services` が起動したものを止めるコマンド。実行するのは eval だけで、ケースごとに実行します。               |
| `ports`     | `0`    | 各 worktree の services と確認が使うポートの数（最大 20）。複数の worktree が同時に確認できるようにします。 |
| `prepare`   | `[]`   | 依存のインストールなど、新しい worktree を準備するコマンド。                                                |
| `tests`     |        | リポジトリのテストファイルを表す glob。必須です。                                                           |
| `generated` | `[]`   | lockfile など、ツールが書くファイルを表す glob。                                                            |
| `gates`     |        | 名前ごとの gate。                                                                                           |
| `levels`    |        | 各水準が実行する gate。                                                                                     |
| `prove`     | `[]`   | 変えたテストファイルの実行方法。                                                                            |

## gate と水準

gate の名前には英小文字、数字、`-` が使え、キーはシェルのコマンドを書く `run` 1 つだけです。コマンドが 0 で終われば、gate は通ります。

`levels` には、`fast`、`full`、`deep` のそれぞれで実行する gate を並べます。gate は順に実行し、最初に失敗したところで止まります。水準は計画の risk tier で決まり、low は `fast`、normal は `full`、high は `deep` です。blueprint はこれを上げられ、handoff の前の最後の確認ではいつも `deep` を実行します。タスクが必要とする水準が constraints になければ、タスクはあなたの対応を待ちます。

## `tests` と `generated`

kozo は、`tests` だけでテストとそれ以外のファイルを見分けます。diff-guard、prove、Charter の `existing_tests_protected` は、すべてこれを使います。

`generated` のファイルは、Charter の行数とファイル数の上限からは外して数えます。scope、保護されたパス、review、prove など、ほかの確認ではほかのファイルと同じように扱います。

## `prove`

各要素には、テストファイルを表す glob の `files` と、`{files}` を含むコマンドの `run` を書きます。kozo は `{files}` を、一致した変更済みのテストファイルに置き換え、シェル用に引用符で囲みます。各ファイルは、最初に一致した要素で実行されます。prove を実行するときにこの一覧が空だと、タスクはあなたの対応を待ちます。

## `services`、`ports`、`teardown`

kozod は `services` を sandbox の外で、prepare の前と、その worktree の以降の run の前に毎回実行します。実行する場所は、worktree の隣に置いたデフォルトブランチのチェックアウトです。`docker compose up -d` のように、動いていないものだけを起動し、動いているものには触れないコマンドにします。services が失敗すると、タスクはあなたの対応を待ちます。

`ports` が 1 以上なら、kozod は worktree ごとに `127.0.0.1` の空いているポートをその数だけ選び、すべてのコマンドに渡します。そのため各 worktree の services は、それぞれ別のポートで待ち受けられます。

## コマンドの環境

`prepare`、gate、prove、codemod は、kozo の [コマンドの sandbox](../security/#コマンドの-sandbox) の中で動きます。kozod の環境から受け取るのは、`PATH`、`HOME`、`USER`、`LOGNAME`、`SHELL`、`LANG`、`LC_ALL`、`TERM` と、コマンドごとの一時的な `TMPDIR` だけです。ほかに次の変数を受け取ります。

| 変数                            | 値                                                                  |
| ------------------------------- | ------------------------------------------------------------------- |
| `KOZO_TASK_ID`                  | worktree ごとに一意の名前。コンテナのプロジェクト名などに使います。 |
| `KOZO_PORT_1`、`KOZO_PORT_2`、… | `ports` が 1 以上のときの、worktree のポート。                      |
| `KOZO_PORTS`                    | 同じポートを空白で区切ったもの。                                    |
| `HTTPS_PROXY`、`HTTP_PROXY`     | `prepare` だけ。ほかのホストへの唯一の経路である kozod のプロキシ。 |
| `KOZO_EGRESS_PORT`              | `prepare` だけ。プロキシのポート。                                  |

各コマンドは Charter の `limits.max_minutes` まで動けます。それを超えると kozod が止め、失敗として扱います。

## `.kozo/verify-app.md`

verify エージェントがアプリを確かめるときの手順です。起動の仕方、起動したことの確かめ方、操作の仕方、証拠の集め方、後片付けを書きます。kozo はこれをデフォルトブランチから読み、タスクの目的と完了の条件と一緒に verify に渡します。このファイルがないと verify は動かず、`kozo check` が警告を出します。

## `AGENTS.md`

kozo のエージェントは、このファイルを記憶として読み込みません。implement の brief が、何かを変える前に読むよう指示します。review は、既定ブランチにあるこのファイルの先頭 12,000 文字に照らして、すべての差分を判定します。モジュールとその依存してよい向き、新しいコードの置き場所、変更で使い回すべき既存の部品、決まりごと、テストの動かし方など、エージェントが知っておくべきことを書きます。import の向きのように道具で確かめられる規則は、ゲートとして constraints にも入れます。
