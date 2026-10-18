---
description: 機械判定と独立AIレビューを通した変更を、レビューポイント付きでPRにする（引数: Issue番号）
allowed-tools: Bash(git fetch:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh issue view:*), Bash(pytest:*), Bash(ruff:*), Bash(npm run:*), Bash(terraform fmt:*), Bash(terraform validate:*), Task
---

現在のブランチからPRを作成する。Issue番号: $ARGUMENTS

## 手順

1. `git fetch origin` のあと、`git status`、`git log origin/main..HEAD --oneline`、`git diff origin/main...HEAD` で変更内容を把握する（ローカルの main は古いことがあるため origin/main と比べる）。mainへ直接pushしない
2. `gh issue view $ARGUMENTS` で、Issueの目的・受け入れ条件・計画コメントを読む
3. **機械判定**: CLAUDE.md の「機械判定のコマンド」から、変更範囲に該当するものを実行する。失敗したらPRを作らず、原因と修正案を報告して止まる
4. **独立レビュー**: `design-reviewer` サブエージェントを起動する
   - 渡すのは、Issue番号と「`git diff origin/main...HEAD` をレビューせよ」という指示だけ。実装中の会話や、自分の意図の説明は渡さない（独立性を保つため）
   - 「重大」「要修正」の指摘は修正し、手順3をやり直して、再レビューする。これを最大2回まで繰り返す
   - 2回で解消しない指摘は、直さずに残し、PR本文の「AIレビュー結果」に書く
5. 差分が大きすぎる（目安: 400行超）場合は、分割案を提示して指示を待つ
6. `.github/pull_request_template.md` の全項目を埋めてPR本文を作る
   - 「変更点」はdiffから書く。「変更の意図」「設計判断」はIssue・計画・この会話から書く
   - 意図や判断の理由がどこからも読み取れない場合は、推測で書かず「要確認」と明記し、ユーザーに質問する
   - 「あえて適用しなかった原則」は、該当がなければ「なし」と書く
   - 「AIレビュー結果」には、最終レビューの結果（指摘件数、直した内容、未解決の指摘）を書く
   - 「レビューしてほしいポイント」は、人が判断すべき箇所（設計判断に迷った点、仕様の解釈、リスク）に絞り、優先順で挙げる。機械判定とAIレビューで足りる点は載せない
7. `gh pr create` でPRを作成し、URLと、本文で「要確認」にした項目、未解決のAIレビュー指摘を報告する
