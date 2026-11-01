---
title: クイックスタート
description: local モードで kozo を準備し、依頼を 1 件、マージまで通して、最後にファクトリーを止めます。
---

local モードで、依頼を 1 件 kozo に通します。依頼を追加して承認し、差分を読んで自分でマージするまでの流れです。kozo がインストール済みで、`claude` にサインインしていることを前提にします。まだなら [インストール](../installation/) を先に済ませてください。

## 1. factory definition を作る

```sh
kozo admin init
```

`kozo admin init` は、kozo のテンプレートを `~/.kozo/factory` に書き出してコミットします。ここは独立した git リポジトリです。factory definition には、`factory.yml`、agents、skills、blueprints、automations が入っています。kozod はこのリポジトリのデフォルトブランチの先端から読むので、変更はコミットしてはじめて効きます。

## 2. リポジトリを登録する

kozo はローカルのクローンで作業します。`~/.kozo/factory/factory.yml` の `repositories` に、作業させるリポジトリを足します。

```yaml
repositories:
  - { path: ~/src/shop }
```

足したらコミットします。

```sh
git -C ~/.kozo/factory commit -am "Work in the shop"
```

リポジトリには、`main` か `master` のブランチ、またはデフォルトブランチを指す `origin/HEAD` が要ります。kozo はそのブランチの先端からファイルを読み、すべてのタスクをそこから始めます。

## 3. リポジトリに kozo のファイルを入れる

```sh
kozo admin install ~/src/shop
```

次の 4 つのファイルを追加します。すでにあるファイルは書き換えません。

| ファイル                | やること                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`             | kozo のエージェントへの指示です。このリポジトリについてエージェントが知っておくべきことを書き足します。`CLAUDE.md` がなければ、`AGENTS.md` へのリンクとして作られます。 |
| `.kozo/charter.yml`     | このリポジトリで kozo がしてよいことです。すべての設定を読んでから、`status: ready` にします。                                                                          |
| `.kozo/constraints.yml` | 変更の確かめ方です。`lint` と `test` の gate をリポジトリのコマンドに置き換え、依存のインストールを `prepare` に足します。                                              |
| `.kozo/verify-app.md`   | verify エージェントがアプリを起動して操作する手順です。これがないと verify は動きません。                                                                               |

kozo はデフォルトブランチの先端から読むので、これらはデフォルトブランチにコミットします。

```sh
cd ~/src/shop
git add AGENTS.md CLAUDE.md .kozo
git commit -m "Let kozo work here"
```

## 4. 準備を確かめる

```sh
kozo check
```

factory definition、各リポジトリの Charter と constraints、`claude` とそのサインイン、コマンドを閉じ込める sandbox を確かめます。指摘を直して実行し直し、すべての確認が通るまで繰り返します。`verify-app.md` がないといった警告だけなら、kozod は止まりません。

## 5. kozod を起動する

```sh
kozo up
```

`kozo up` は kozod をバックグラウンドで起動し、`kozod is up: http://127.0.0.1:7420` と表示します。kozod のログは `~/.kozo/kozod.log` に書かれます。いま何をしているかは `kozo status` で見られます。

## 6. 依頼を追加する

```sh
kozo add "Fix the broken link in the cart page footer"
```

1 行目が item のタイトルになり、2 行目以降と `-f` で渡したファイルの中身が本文になります。リポジトリを複数登録しているときは、`--repo <path>` でどれかを指定します。kozo は `K-1` のような item の reference を返します。

Charter の初期設定では、すべての work class の自律度が L1 です。そのため item は開始の承認を待ち、`kozo add` はそのことを終了コード 3 で知らせます。

## 7. inbox を片付ける

`kozo ls` は、あなたを待っているものを古い順に並べます。

```sh
kozo ls
```

開始を承認すると、triage エージェントがリポジトリを読んで計画を下書きします。

```sh
kozo approve K-1
```

L1 では、計画もあなたの承認を待ちます。`kozo show K-1` で、work class、risk tier、方針、各タスクの目的を読み、承認するか、理由を付けて差し戻します。

```sh
kozo show K-1
kozo approve K-1
# または
kozo reject K-1 "Keep the change to the footer template"
```

エージェントが質問してきたら `kozo ls` に出ます。`kozo say K-1 "<answer>"` で答えます。

作業の進み具合を追うには `kozo show K-1/t1 -f` を実行するか、`kozo dashboard` でダッシュボードを開きます。

## 8. 差分を読んでマージする

タスクがすべての確認を通ると、inbox でマージを待ちます。kozo は handoff report を `~/.kozo/items/K-1/handoff-t1.md` に書きます。中身は、変更の理由、変えたもの、範囲外にしたもの、安全と言える根拠、確認の結果です。差分を読みます。

```sh
kozo show K-1/t1 --diff
```

タスクブランチを、自分でデフォルトブランチにマージします。handoff report の最後に、次の形のコマンドがそのまま書かれています。

```sh
git merge --no-ff kozo/<factory ID>/K-1-t1
```

kozod は 1 分以内にマージに気づきます。通常のマージでも、rebase でも、squash でもかまいません。マージ後のデフォルトブランチで gate をもう一度実行し、タスクを、続いて item を完了にします。

## 9. ファクトリーを止める

```sh
kozo down
```

## 次に読むもの

- [コンセプト](../concept/) では、item、task、hold、自律度を説明しています。
- `kozo` を引数なしで実行すると、すべてのコマンドが一覧できます。
