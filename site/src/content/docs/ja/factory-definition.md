---
title: factory definition
description: factory.yml のキーと、~/.kozo/factory にある agents、skills、blueprints、automations、eval のケース、kozod が変更を適用する仕組みを説明します。
---

factory definition は、`kozo admin init` が作る `~/.kozo/factory` の git リポジトリです。マシン全体の設定と、エージェントが従う指示や手順のすべてが入っています。

```text
~/.kozo/factory/
├── factory.yml
├── agents/<name>/agent.md      triage, plan, implement, review, verify, explorer
├── skills/verify-app/SKILL.md
├── blueprints/<class>.yml      docs, deps, bugfix, refactor, perf, migration, feature
├── automations/<name>.md
└── evals/<case>.yml
```

## 変更が適用される仕組み

kozod は、作業中のファイルではなく、このリポジトリのデフォルトブランチの先端のコミットから definition 全体を読みます。新しいコミットがないかは、1 分ごとに確かめます。

- **先端が有効なら適用します。** kozod はそれを記録し、以降に始めるすべての作業で使います。
- **先端が無効なら拒みます。** kozod は理由を報告して通知し、最後に適用した definition で動き続けます。コミットする前に `kozo check` で同じエラーを確かめられます。
- **起動時**は、先端が有効ならそれを、無効なら最後に適用した definition を使います。どちらも使えなければ起動しません。
- **ファイルがないときは、kozo に組み込まれた同じパスのテンプレートを使います。** ただし automations は例外で、definition 自身にあるファイルだけが数えられます。

## `factory.yml`

すべてのキーを厳密に確かめるので、知らないキーはエラーになります。省いたキーは既定値になり、オブジェクトを書いたときは、既定のオブジェクト全体がそれに置き換わります。

| キー                    | 既定値              | 意味                                                                                                                                                       |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`               | `1`                 | 形式のバージョン。いつも `1` です。                                                                                                                        |
| `mode`                  | `local`             | `local` か `github`。[GitHub モード](../github-mode/) を参照してください。モードの変更は、kozod を起動し直したときに適用されます。                         |
| `runtime`               | `sdk`               | エージェントがあなたの `claude` を動かす方法。`sdk` は Agent SDK 経由、`cli` は `claude -p` です。review と verify は、いつも Agent SDK を使います。       |
| `repositories`          | `[]`                | kozo が作業するローカルのクローン。                                                                                                                        |
| `repositories[].path`   |                     | クローンのパス。`~` は展開されます。                                                                                                                       |
| `repositories[].github` |                     | GitHub モードでの `<owner>/<name>`。GitHub モードでは必須で、同じ名前のリポジトリを 2 つは登録できません。                                                 |
| `repositories[].label`  |                     | GitHub モードで、このラベルの付いた開いている Issue だけを item にします。`kozo:` で始まる名前は使えません。                                               |
| `agent_defaults.model`  | `claude-sonnet-5-5` | ほかのキーで指定しない限り、すべてのエージェントが使うモデル。                                                                                             |
| `agents.<name>.model`   |                     | 1 つのエージェントのモデル。その `agent.md` と `agent_defaults` より優先します。                                                                           |
| `concurrency`           | `1`                 | kozod が同時に動かす run、確認、下書きの数。すべてのリポジトリを合わせた数です。                                                                           |
| `budget.daily_usd`      | `15`                | 1 日の支出の上限。ローカル時刻の午前 0 時から数えます。[運用](../operations/#予算) を参照してください。                                                    |
| `prepare_hosts`         |                     | prepare がパッケージのレジストリ以外に接続してよいホスト。レジストリのミラーなどを、名前か `*.` で始まる接尾辞で書きます。起動し直さなくても適用されます。 |

```yaml
version: 1
mode: local
runtime: sdk
repositories:
  - { path: ~/src/shop }
agent_defaults:
  model: claude-sonnet-5-5
agents:
  review: { model: claude-opus-5-5 }
concurrency: 2
budget:
  daily_usd: 20
prepare_hosts: [npm.example.com]
```

## agents

`agents/<name>/agent.md` が、1 つのエージェントを定義します。本文がセッションのシステムプロンプトになり、front matter には 3 つのキーを書きます。

| キー          | 意味                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| `name`        | エージェントの名前。必須です。                                                             |
| `description` | 何をするかの 1 行。必須です。                                                              |
| `model`       | 省略できるモデル。`factory.yml` がこのエージェントのモデルを指定していなければ使われます。 |

エージェントが使えるツールは、definition ではなく kozo が決めています。implement、triage、plan は worktree の中でファイルとシェルを使い、triage と plan は書き込みができません。review と explorer はツールを持たない判定役で、verify はシェルだけを使います。

## skills

kozo が読む skill は `skills/verify-app/SKILL.md` の 1 つだけで、その本文を verify エージェントの指示に足します。front matter には、`name`、`description`、`disable-model-invocation: true` を書きます。

## blueprints

`blueprints/<class>.yml` は、その work class のタスクが Building から Handoff まで進む方法を決めます。blueprint のない class は、bugfix のものを使います。

| キー        | 意味                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`   | いつも `1` です。                                                                                                                                                                                                       |
| `nodes`     | 段階。順番はいつも `claim`、`prepare`、`brief`、`implement`、`verify-deterministic`、`review`、`verify-app`、`handoff`、`final-verify` です。どのノードも省けません。verify を実行するかどうかは risk tier が決めます。 |
| `reproduce` | `true` なら、変えたテストは変更なしでは失敗しなければなりません。`false` は振る舞いを変えない作業向けで、足したテストは変更なしでも通らなければなりません。                                                             |
| `gates`     | 省略できる、gate の水準の下限。`fast`、`full`、`deep` のいずれかで、risk tier に関係なく適用されます。                                                                                                                  |

## automations

automation は、決まった時刻に item を追加します。local モードでだけ動きます。`automations/` に Markdown のファイルを 1 つずつ置きます。

```markdown
---
version: 1
schedule: '0 3 * * *'
class: bugfix
---

# Fix one error that the code swallows

What to change and why.
```

| キー         | 意味                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `version`    | いつも `1` です。                                                                                                                          |
| `schedule`   | kozod のローカル時刻での、5 つの欄の cron。数、`*`、列挙、範囲、間隔が使えます。kozod が動いていなかった時刻の分は、あとから追加しません。 |
| `repository` | 登録したとおりのリポジトリのパス。登録が 1 つだけなら省略できます。                                                                        |
| `class`      | 省略できる work class。                                                                                                                    |

本文は `# <title>` で始め、残りが依頼になります。automation の item は、いつも開始と計画の承認を待ちます。同じタイトルの item が開いている間は、新しく追加しません。

`kozo admin init` は、`nightly-habit.md` という automation を 1 つ入れてコミットします。これは毎晩 03:00 に、握りつぶされたエラーを 1 か所直す依頼を追加します。止めるには、ファイルを消してコミットします。

## eval のケース

`evals/<case>.yml` は、過去の依頼と、それが行き着くべき結果を書いたものです。`kozo admin eval add` で run から下書きを作れます。[運用](../operations/#eval) を参照してください。

| キー                                 | 意味                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| `version`                            | いつも `1` です。                                                |
| `id`                                 | ケースの名前。英小文字、数字、`.`、`_`、`-` が使えます。         |
| `repository`、`start`                | ケースを始めるリポジトリとコミット。                             |
| `request`                            | タイトルと本文。Issue なら、タイトル、URL、本文の SHA-256 です。 |
| `expected.outcome`                   | `complete`、`question`、`split`、`attention` のいずれか。        |
| `expected.hidden`、`expected.checks` | エージェントには見せず、結果に対して実行するテストとコマンド。   |
