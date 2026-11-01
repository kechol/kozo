---
title: 運用
description: kozo がデータを置く場所、通知、予算と一時停止の仕組み、止め方・アップグレード・削除の手順、うまく動かないときに確かめることを説明します。
---

kozo は、何日も人の手を離れて動かすためのものです。このページでは、動かし続けるために要ることと、止まったときにすることを説明します。

## データの置き場所

すべて `~/.kozo`、または `KOZO_HOME` で指定したディレクトリに入ります。

| パス                      | 中身                                                                                              | 作り直せるか                    |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------- |
| `events.jsonl`            | ファクトリー自体の event log。                                                                    | できない                        |
| `runs/<run>/events.jsonl` | 各 run の event log。                                                                             | できない                        |
| `items/<item>.md`         | 各 item の依頼。書かれたままの内容です。                                                          | できない                        |
| `factory/`                | factory definition。あなた自身の git リポジトリです。                                             | あなたのもの                    |
| `kozo.db`                 | local API が読む SQLite のインデックス。                                                          | できる。起動のたびに作り直す    |
| `api.token`               | CLI が使う token。あなただけが読めます。                                                          | できる。消せば kozod が作り直す |
| `kozod.log`               | kozod の出力。起動を拒んだ理由なども出ます。                                                      | 要らない                        |
| `items/<item>/`           | 各タスクの handoff report と、マージ後に実行した gate のログ。                                    | できない                        |
| `runs/<run>/`             | event log のほか、brief、run report、判定、decision log、証拠、長いツールの出力、コマンドのログ。 | できない                        |
| `worktrees/`              | 開いている各タスクの worktree。                                                                   | タスクが閉じると消える          |

ほかのものはすべて、event log をもとに作られます。各ログは行ごとにつながっていて、run が終わると封をします。封をしたログがなくなったり書き換えられたりしていると、kozod は起動しません。手で編集したり消したりせず、古い run は下の prune で整理します。

エージェントのセッションは、自分の記録を残しません。各メッセージとツールの呼び出しは、run の event log に記録されます。`~/.kozo` の中には、ローテーションや容量の上限がありません。run のディレクトリは、使うほど大きくなります。

## 環境変数

kozo と kozod は、環境から次の変数を読みます。`kozo up` は自分の環境を kozod に渡すので、両方に同じように設定します。

| 変数          | 意味                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| `KOZO_HOME`   | ファクトリーのホーム。既定は `~/.kozo` です。                                           |
| `KOZO_PORT`   | local API のポート。既定は 7420 です。                                                  |
| `KOZO_CLAUDE` | 実行する `claude`。`PATH` 上のもの以外を使うときに指定します。                          |
| `KOZOD`       | `kozo up` が起動する `kozod`。`kozo` の隣か `PATH` 上のもの以外を使うときに指定します。 |
| `KOZO_NOTIFY` | `off` にすると通知を止めます。                                                          |

リポジトリのコマンドは、ポートなど自分用の変数を別に受け取ります。[constraints](../constraints/#コマンドの環境) を参照してください。

## 通知

あなたの対応が要るとき、kozod は OS の通知で知らせます。

- タスクが、レビューとマージの準備を終えた。
- kozod が item かタスクを、承認、回答、対応の待ちで止めた。
- 承認が 2 日、4 日、6 日待っている。
- その日の支出が、1 日の予算の 50%、80%、100% を超えた。
- ファクトリーが自分で止まった。
- kozod が新しい factory definition を拒んだ。
- kozod が class の自律度を下げた。

macOS では通知センターに、Linux では `notify-send` があればそれで表示します。止めるには、kozod の環境で `KOZO_NOTIFY=off` を設定します。

## 予算

`factory.yml` の `budget.daily_usd` は、1 つのファクトリーのホームが 1 日に使える額の上限です。ローカル時刻の午前 0 時から、すべてのセッションの分を数えます。

- **上限に達すると、新しく始めることだけを止めます。** 動いているセッションは最後まで続きます。始めようとしたタスクは capacity で待ち、翌日になると kozod がこれを外します。
- **動いている作業は前もって数えます。** 動いている作業はそれぞれ、リポジトリの `limits.max_cost_usd` の分を確保します。そのため kozod は、その日の予算を超えるおそれのある作業を始めません。
- **セッションごとにも上限があります。** Charter の `limits.max_cost_usd` が、review と verify も含めた各エージェントのセッションの上限です。
- **予算を使い切った日は、explorer も断ります**（`kozo say --ask`）。

`kozo report --cost` は、日ごとの費用を予算と並べて表示します。`kozo status --line` は、今日の費用を含めてステータスバー用の 1 行を表示します。

```text
kozo: up local · 1 running · 2 waiting · $3.40 today
```

## 一時停止

| 止めるもの                      | 方法                                                       | 起きること                                                 |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| ファクトリー                    | `kozo pause`、またはダッシュボードの **Pause factory**     | 新しい作業を始めません。動いている作業は最後まで続きます。 |
| item、task、run の 1 つ         | `kozo pause <ref>`                                         | 次の段階で止まります。                                     |
| item、task、run の 1 つを今すぐ | `kozo pause <ref> --now`、またはダッシュボードの **Pause** | そのセッションと、実行中のコマンドをすぐに止めます。       |

どれも、`kozo resume`（必要なら reference を付けて）で元に戻ります。

kozod が自分でファクトリーを止めるのは、Claude API で失敗したセッションが 3 回続いたときと、GitHub モードで書き込める人が開いている Issue に `kozo:paused` を付けたときです。理由は `kozo status` に出ます。factory definition を拒んだときは、何も止めません。kozod は、最後に適用した definition で動き続けます。

## 止める・起動し直す

`kozo down` は kozod に停止を求め、最大 15 秒待ちます。kozod は、すべてのエージェントのセッションを止め、各タスクを次の段階でチェックポイントを残して止めてから終了します。次に `kozo up` すると、各タスクは止まったところから続きます。

クラッシュや電源断などで kozod が強制終了したときは、次の起動時に、失った run に印を付け、そのタスクを最後に入った段階から再開します。implement のセッションが途中で切れたときは、タスクが attention で止まります。`kozo retry` で続きを実行します。

## アップグレード

実行ファイルを入れ替える前に kozod を止め、そのあと新しいものを起動します。

```sh
kozo down
brew upgrade kozo
kozo up
```

kozod は、自分の実行ファイルからワーカーを起動します。アップグレードの間も kozod を動かしたままにすると、新しい実行ファイルからワーカーを起動してしまいます。`kozo --version` と `kozod --version` でバージョンが分かり、どの run にも、それを実行したバージョンが記録されます。

## 古い run の整理

```sh
kozo admin prune --older-than 30 --dry-run
kozo admin prune --older-than 30
```

`prune` は、item が閉じてから指定した日数以上たった run について、event log、run report、判定、decision log を残し、brief、証拠、長いツールの出力、コマンドのログを消します。`items/` には触れません。`--dry-run` は、消すものを一覧にするだけです。kozod が動いている必要があります。

## インデックスの作り直し

`kozo.db` は kozod が起動するたびに event log から作り直されるので、インデックスがおかしいと思ったら起動し直せば足ります。`kozo admin db-rebuild` は、起動し直さずに同じことをします。

## kozo を取り除く

1. `kozo down` で kozod を止め、実行ファイルをアンインストールします（`brew uninstall kozo`）。
2. 各リポジトリで、タスクブランチと、そのために git が持っている worktree の記録を消します。

   ```sh
   git worktree prune
   git branch --list 'kozo/*'
   git branch -D <branch>...
   ```

3. `~/.kozo` を消します。コピーを取っておかない限り、factory definition も消えます。
4. 要らなければ、各リポジトリから kozo のファイルを消します。`AGENTS.md`、`CLAUDE.md`、`.kozo/`、GitHub モードなら `.github/workflows/kozo.yml` です。
5. GitHub モードでは、GitHub 上の `kozo/*` ブランチと `kozo:` のラベル、追加していれば ruleset も消します。

kozo は完了したタスクのブランチを残すので、動かしている間の片付けにも手順 2 が使えます。

## うまく動かないとき

### kozod が起動しない

`kozo up` が起動しなかったことを伝え、`~/.kozo/kozod.log` を示します。理由はそこに書かれています。

| メッセージ                                                                       | すること                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `sandbox-exec does not run`、`bwrap does not run`、`bubblewrap is not installed` | sandbox を動くようにします。足りないものは `kozo check` が示します。Linux ではユーザー名前空間を許可します。 |
| `kozod is already running as pid <n>`                                            | 別の kozod がこのホームを使っています。それを使うか、`kozo down` で止めます。                                |
| `... does not match its seal`、`... is missing; it was sealed at ...`            | event log が書き換えられたか消されました。バックアップから戻します。                                         |
| `the factory definition is invalid`                                              | `kozo check` を実行して definition を直します。                                                              |
| `api.token is readable by others`                                                | `chmod 600 ~/.kozo/api.token` を実行します。                                                                 |

### 何かが進まない

1. `kozo ls` で、あなたを待っているものを見ます。`kozo status` で、ファクトリーが止まっているか、その理由を見ます。
2. `kozo show <ref>` で stage と hold とその理由を見ます。`kozo show <ref> -f` で動きを追えます。
3. `kozo say --ask <ref> "<question>"` で explorer に尋ねます。explorer は記録を読んで答え、作業には触れません。
4. `~/.kozo/runs/` の各 run のディレクトリに、コマンドと gate のログがあります。

`kozo check` は準備の問題点を報告するだけで、何も変えません。

## eval

eval のケースは、過去の依頼を factory definition に流し直し、agents や blueprints を変えても同じ結果になるかを確かめるものです。

- `kozo admin eval add <run>` は、run の item からケースの下書きを `~/.kozo/factory/evals/<repository>-<item>.yml` に作ります。隠しテストとチェックを足してから、コミットします。
- `kozo admin eval run` は、すべてのケース、または指定したケースを、それぞれ使い捨てのファクトリーのホームとリポジトリのクローンで実行します。期待した結果になった数と、かかった費用を表示します。この費用は、ファクトリーの 1 日の予算には数えません。
