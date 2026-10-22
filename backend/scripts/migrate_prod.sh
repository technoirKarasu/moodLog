#!/usr/bin/env bash
# 本番DBにマイグレーションを流す。VPC内のLambda（moodlog-migrate）を呼ぶ（docs/adr/0011-prod-migration.md）。
# Issue #76: 手元の手順（infra/README.md）と main マージ時のデプロイで、同じこのスクリプトを使う
#
# 使い方: リポジトリのどこからでも `backend/scripts/migrate_prod.sh` を実行する。
# 前提: aws CLI が使え、moodlog-migrate を呼ぶ権限があること
set -euo pipefail

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT

# --cli-read-timeout 0: 既定の60秒で読み取りがタイムアウトすると、CLIが呼び直し、マイグレーションが2回流れうるため
metadata="$(aws lambda invoke \
  --function-name moodlog-migrate \
  --cli-read-timeout 0 \
  --output json \
  "${response_file}")"

# 関数が失敗しても aws lambda invoke は終了コード0を返すため、FunctionError で判定する
if [[ "$(jq -r '.FunctionError // empty' <<<"${metadata}")" != "" ]]; then
  echo "マイグレーションに失敗した:" >&2
  cat "${response_file}" >&2
  echo >&2
  echo "alembic のログ: aws logs tail /aws/lambda/moodlog-migrate --since 1h" >&2
  exit 1
fi

# 成功したら {"revision": "<適用後のリビジョン>"} が返る
cat "${response_file}"
echo
