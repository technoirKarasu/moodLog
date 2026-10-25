#!/usr/bin/env bash
# 保存した plan に、自動では apply しない変更が含まれていたら止める（docs/adr/0012-deploy.md、docs/adr/0013-github-actions-deploy-policy.md）。
# Issue #76: main マージ時のデプロイは、これが通ったときだけ apply する。
# Issue #83: GitHub Actions のロールは既存のリソースの更新しかできないので、次を含む plan で止める。
#   - リソースの作成・削除・作り直し
#   - IAM のリソース（aws_iam_*）の変更。ロールが自分やほかのロールの権限を広げられないようにするため
#   - S3 のバケットポリシーと公開アクセスブロックの変更。外部に許可を出せないようにするため
# 止まった変更は、手元で plan を確かめてから apply する（infra/README.md）
#
# 使い方: `infra/scripts/check_plan.sh <planファイル>`
#   planファイルは `terraform -chdir=infra plan -out=<planファイル>` で作ったもの。パスは infra/ からの相対パス
#
# plan の JSON には、sensitive の値（DBのパスワードなど）が平文で入る。
# Actions のログは公開されるため、JSON はファイルに書かず jq に渡すだけにし、
# 出すのは該当するリソースの address と actions だけにする
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "使い方: $0 <planファイル>" >&2
  exit 2
fi

infra_dir="$(cd "$(dirname "$0")/.." && pwd)"

# 作り直しは actions が ["delete","create"] か ["create","delete"] になるので、create と delete を探せば拾える。
# data（mode が data）の読み取りは変更ではないので見ない
manual="$(terraform -chdir="${infra_dir}" show -json "$1" |
  jq -r '.resource_changes[]?
    | select(.mode == "managed")
    | select(
        (.change.actions | index("create") or index("delete"))
        or (
          (.type | startswith("aws_iam_") or . == "aws_s3_bucket_policy" or . == "aws_s3_bucket_public_access_block")
          and (.change.actions | index("update"))
        )
      )
    | "\(.address) \(.change.actions | join(","))"')"

if [[ -n "${manual}" ]]; then
  echo "作成・削除・作り直しか、IAM・S3 のバケットポリシー・公開アクセスブロックの変更を含むため、自動では apply しない。手元で plan を確かめてから apply する:" >&2
  echo "${manual}" >&2
  exit 1
fi

echo "作成・削除・作り直しと、IAM・S3 のバケットポリシー・公開アクセスブロックの変更は含まれていない"
