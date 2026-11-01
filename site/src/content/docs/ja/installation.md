---
title: インストール
description: macOS と Linux で kozo に要るもの、Homebrew・リリースのアーカイブ・ソースからの入れ方、入れたあとの確かめ方を説明します。
---

kozo は 2 つの実行ファイルでできています。コマンドラインの `kozo` と、常駐するプロセスの `kozod` です。2 つとも同じ `PATH` に置きます。

## 必要なもの

| 必要なもの                                                                                                           | 理由                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| macOS、または x64 か arm64 の Linux                                                                                  | kozo は、実行するコマンドを閉じ込められる環境でしか動きません。                                   |
| `PATH` 上の [Claude Code](https://docs.anthropic.com/en/docs/claude-code)。`claude auth login` でサインインしておく  | kozo のエージェントは、あなた自身の `claude` で動きます。                                         |
| Git                                                                                                                  | kozo は git の worktree とブランチで作業します。                                                  |
| `lsof`                                                                                                               | kozod が、エージェントのセッションが残したプロセスを見つけて止めるのに使います。                  |
| Linux では [bubblewrap](https://github.com/containers/bubblewrap)（`bwrap`）。ユーザー名前空間を作れるようにしておく | エージェントのシェルと、prepare・gate・prove のコマンドを閉じ込めます。                           |
| Linux では [socat](http://www.dest-unreach.org/socat/)                                                               | Claude Code の sandbox が使います。kozo の sandbox も、許可したポートへの接続をこれで中継します。 |

macOS では、OS に入っている `sandbox-exec` が閉じ込めを行います。

kozod は、これらのコマンドを閉じ込められない環境では起動しません。理由は `kozo check` が示します。

## Homebrew

```sh
brew install kechol/tap/kozo
```

formula は、macOS と Linux の Apple silicon、Intel、ARM 向けに `kozo` と `kozod` を入れます。

## リリースのアーカイブ

各 [GitHub Release](https://github.com/kechol/kozo/releases) には、プラットフォームごとのアーカイブ `kozo-<version>-<target>.tar.gz`（`darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`）と、`SHA256SUMS.txt` があります。アーカイブをこれと照らし合わせてから、2 つの実行ファイルを `PATH` に置きます。

```sh
grep kozo-<version>-<target>.tar.gz SHA256SUMS.txt | shasum -a 256 --check
tar -xzf kozo-<version>-<target>.tar.gz kozo kozod
```

## ソースから

ビルドには、`package.json` で固定している [Bun](https://bun.sh) 1.4.2 が要ります。

```sh
git clone https://github.com/kechol/kozo.git
cd kozo
bun install --frozen-lockfile
bun run compile
```

`bun run compile` は、いまのプラットフォーム向けの `dist/kozo` と `dist/kozod` を書き出します。2 つとも `PATH` に置きます。

## インストールを確かめる

```sh
kozo --version
kozo check
```

factory definition を作る前は、`kozo check` はそれがないと報告します。ほかの確認、つまり `claude` とそのフラグとサインイン、sandbox、`lsof` を見れば、このマシンで kozo を動かせるかが分かります。続きは [クイックスタート](../quick-start/) です。

## kozo がファイルを置く場所

kozo が書くものは、すべて `~/.kozo`、または `KOZO_HOME` で指定したディレクトリに入ります。factory definition、event log、`kozo.db` のインデックス、API token、各タスクの worktree です。
