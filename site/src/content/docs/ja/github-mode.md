---
title: GitHub モード
description: kozo は GitHub の Issue から依頼を受け取り、pull request で返します。kozo のしていることと、あなたを待っているものは、ラベルとコメントで分かります。
---

GitHub モードでは、kozo はリポジトリの開いている Issue から依頼を受け取り、検証済みの差分を pull request で返します。承認、回答、マージは、GitHub と `kozo` の手近なほうで行えます。kozod は、これまでどおりあなたのマシンで動きます。5 分ごとに GitHub を読みにいき、ポートは開かないので、webhook の設定は要りません。

## local モードとの違い

|                       | local モード                     | GitHub モード                                                             |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| 依頼                  | `kozo add` と automation         | 開いている Issue と `kozo add`                                            |
| item の reference     | `K-<n>`                          | Issue なら `shop#42` のような `<repository>#<n>`。`kozo add` なら `K-<n>` |
| タスクの起点          | ローカルのデフォルトブランチ     | 5 分ごとに fetch する `origin` のデフォルトブランチ                       |
| 差分                  | あなたがマージするタスクブランチ | あなたがマージする pull request                                           |
| kozo のファイルの導入 | クローンに直接書き込む           | pull request で開く                                                       |
| automation            | 動く                             | 動かない                                                                  |

GitHub モードの kozod は、ローカルのブランチを動かしません。相手にするのは `origin` だけです。

## 準備

### 1. gh にサインインする

kozod が GitHub に触れるのは [GitHub CLI](https://cli.github.com/) 経由だけで、使うのは、gh で github.com にサインインしているアクティブなアカウントです。実行する gh のコマンドも、決まった一覧に限られます。kozo に操作させたいアカウントでサインインします。

```sh
gh auth login
gh auth status
```

kozod のコメント、push、pull request は、このアカウントのものになります。あなた自身のアカウントでもかまいません。エージェントや、kozo が実行するコマンドからは、このサインインは見えません。

### 2. リポジトリを登録する

`~/.kozo/factory/factory.yml` でモードを設定し、各リポジトリに対応する GitHub のリポジトリを書きます。ローカルのクローンの `origin` は、そのリポジトリを指していなければなりません。

```yaml
mode: github
repositories:
  - { path: ~/src/shop, github: me/shop }
  - { path: ~/src/site, github: me/site, label: kozo }
```

| キー     | 意味                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github` | リポジトリの `<owner>/<name>`。GitHub モードでは必須です。reference は owner を省くので、同じ名前のリポジトリを 2 つは登録できません。                |
| `label`  | 省略できます。指定すると、このラベルの付いた開いている Issue だけが item になります。`kozo:` で始まる名前は使えません。                               |
| `locale` | 省略できます。kozod がここに書くコメント、pull request、ラベルの説明の言語です。省くと `factory.yml` の `locale` になります。ラベル名は変わりません。 |

変更をコミットしたら、`kozo down` と `kozo up` で kozod を起動し直します。kozod は、動いている間のモードの変更を受け付けません。

### 3. pull request で kozo のファイルを入れる

```sh
kozo admin install ~/src/shop
```

GitHub モードでは、kozod がブランチ `kozo/<factory ID>/install` から **kozo を導入する**（リポジトリの `locale` が `en` なら **Install kozo**）という pull request を開きます。追加されるファイルは local モードと同じで、ほかに `.github/workflows/kozo.yml` が加わります。このワークフローは、pull request のたびに `kozo check .` を実行します。マージする前に、次を済ませます。

1. `AGENTS.md` にリポジトリの説明を書く。
2. `.kozo/constraints.yml` と `.kozo/verify-app.md` のコマンドを、リポジトリのものに置き換える。
3. `.kozo/charter.yml` のすべての設定を読んで、`status: ready` にする。

`origin` のデフォルトブランチ上の Charter が ready になるまで、kozo はそのリポジトリの Issue を取り込みません。

pull request の本文には、**kozo: default branch** という ruleset を追加する `gh api` のコマンドも書かれています。内容は、削除の禁止、force push の禁止、pull request 経由の変更だけを許すこと、`kozo check` を必須のステータスチェックにすることです。kozod はリポジトリの設定を変えないので、ruleset が欲しければ管理者がこのコマンドを実行します。

### 4. 確かめる

```sh
kozo check
```

GitHub モードの `kozo check` は、各リポジトリの `.kozo/` のファイルを `origin` のデフォルトブランチから読みます。あわせて、gh が github.com にサインインしているかを確かめ、kozod が使うアカウントを表示します。

## item になる Issue

kozod は、読みにいくたびに各リポジトリの開いている Issue を読みます。`label` を指定していれば、そのラベルの付いた Issue だけを読みます。bot の Issue と、`kozo:paused` の付いた Issue は取り込みません。

Issue の作成者がリポジトリに書き込める（write、maintain、admin のいずれかのロールを持つ）人で、リポジトリを登録したあとに開いた Issue は、信頼できる依頼として扱います。信頼できる Issue は [自律度](../concept/#自律度) に従います。それ以外の Issue は、どの自律度でも開始と計画の両方の承認が要ります。

| 承認 | GitHub で                                   | kozo で                                 |
| ---- | ------------------------------------------- | --------------------------------------- |
| 開始 | 書き込める人が `kozo:accept` ラベルを付ける | `kozo approve shop#42` かダッシュボード |
| 計画 | できない                                    | `kozo approve shop#42` かダッシュボード |

GitHub での編集やクローズは、kozo にも反映されます。

- **タイトルや本文を編集すると**、以降の run は編集後の内容を依頼として使います。作業の開始後に、書き込めない人が編集したときは、item を attention で止めます。`kozo retry` で新しい本文を取り込みます。
- **Issue を閉じたとき:**
  - 書き込める人が completed として閉じると、item は完了になります。
  - 書き込める人か作成者が not planned か duplicate として閉じると、item と開いているタスクは取り消しになります。
  - それ以外の閉じ方では、item を attention で止めます。

## ラベル

kozod は、次のラベルを各リポジトリに作り、stage と待ちのラベルを item の状態に合わせて付け替えます。

| ラベル                            | 付ける人 | 意味                                                                                                                                                      |
| --------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kozo:intake` 〜 `kozo:cancelled` | kozod    | item の stage（intake、triage、planning、building、reviewing、handoff、complete、cancelled）。開いているタスクがあれば、その中でいちばん前の stage です。 |
| `kozo:needs-approval`             | kozod    | 開始か計画の承認が、あなたを待っています。                                                                                                                |
| `kozo:needs-question`             | kozod    | 質問が、あなたの回答を待っています。                                                                                                                      |
| `kozo:needs-attention`            | kozod    | item かタスクが、あなたの対応を待っています。                                                                                                             |
| `kozo:accept`                     | あなた   | 開始の承認を待っている Issue の開始を承認します。                                                                                                         |
| `kozo:paused`                     | あなた   | この Issue が開いている間、ファクトリー全体を止めます。書き込める人が付けたときだけ効きます。                                                             |

kozod が付け外しするのは、stage と `needs` のラベルだけです。Issue に付いているほかのラベルは、あなたのものです。

## コメント

kozod は、作業している Issue ごとに **status comment** を 1 つ置き、状況が変わるたびに書き換えます。中身は、stage、item が待っているもの、各タスクの stage と pull request、ここまでの費用です。

質問が出ると、kozod はそれを Issue にコメントします。リポジトリに書き込める人なら、そのコメントへの返信で答えられます。`kozo say shop#42 "<answer>"` でもかまいません。kozo は、質問のあとに書き込める人が付けた最初の返信を回答として受け取り、指示ではなくデータとしてエージェントに渡します。

タスクがレビューとマージの準備を終えたときも、kozod はその pull request を添えてコメントします。コメントや pull request に入るエージェントの文章では、人へのメンションも Issue を閉じるキーワードも効きません。kozod がそれらを無効にします。

## pull request

タスクがすべての確認を通ると、kozod はそのブランチ `kozo/<factory ID>/<n>-t<t>`（`<n>` は Issue の番号）を push し、デフォルトブランチへの pull request を開きます。タイトルはタスクの目的で、本文は handoff report のあとに `#<n> の一部です`（`en` なら `Part of #<n>`）を続けたものです。下書き（draft）ではなく、すぐレビューできる状態で開きます。

そのあと kozod は、pull request の動きを追います。

| GitHub で起きたこと                          | kozod がすること                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| あなたがマージした（マージの方法は問わない） | マージ後のデフォルトブランチで gate を実行し、タスクを完了にします。すべてのタスクが完了したら、item を完了にして Issue を閉じます。              |
| 書き込める人が変更を求めた                   | レビューの文章を指示として、タスクを Building に戻します。                                                                                        |
| チェックが失敗した                           | Charter の `limits.ci_fix_rounds` の回数まで、タスクを Building に戻します。それを超えたら、attention で止めます。`kozo retry` で回数が戻ります。 |
| 誰かがブランチにコミットを push した         | そのコミットを取り込み、review と verify をやり直します。                                                                                         |
| あなたがマージせずに閉じた                   | タスクを attention で止めます。`kozo retry` で新しい pull request を開きます。                                                                    |

pull request をマージしても、Issue はそれだけでは閉じません。kozod は、マージ後のデフォルトブランチで gate が通り、item が完了したときに Issue を閉じます。

## ローカルの item を Issue に移す

```sh
kozo issue K-7
```

item のタイトルと依頼の本文で、そのリポジトリに Issue を開きます。リポジトリに `label` があれば、それも付けます。そのうえでローカルの item を取り消します。kozod は、次に読みにいったときに、その Issue を新しい item として取り込みます。移せるのは、開いていて、まだタスクがなく、`github:` のあるリポジトリの item だけです。

## kozod が GitHub でできること

kozod は、決まった一覧にない gh のコマンドを、実行する前に拒否します。一覧で許しているのは次の操作です。

- Issue、その event、ユーザーの権限を読む。
- 自分のラベルを作り、ラベルを付け外しする。
- コメントを書き、自分のコメントを編集する。
- `kozo issue` のために Issue を開き、Issue を completed として閉じる。
- pull request を開き、その本文を書き換える。
- pull request とそのチェックを読む。

git が GitHub に触れるのは、`origin` の fetch、push、ref の一覧の取得だけです。マージ、リポジトリの設定の変更、自由な API の呼び出しはできません。
