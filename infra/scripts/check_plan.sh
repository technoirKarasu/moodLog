#!/usr/bin/env bash
# 保存した plan に、リソースの削除か作り直しが含まれていたら止める（docs/adr/0012-deploy.md）。
# Issue #76: main マージ時のデプロイは、これが通ったときだけ apply する。
# 削除や作り直しを含む変更は、手元で plan を確かめてから apply する（infra/README.md）
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

# 作り直しは actions が ["delete","create"] か ["create","delete"] になるので、delete を探せば両方を拾える
destructive="$(terraform -chdir="${infra_dir}" show -json "$1" |
  jq -r '.resource_changes[]? | select(.change.actions | index("delete")) | "\(.address) \(.change.actions | join(","))"')"

if [[ -n "${destructive}" ]]; then
  echo "削除か作り直しを含むため、自動では apply しない。手元で plan を確かめてから apply する:" >&2
  echo "${destructive}" >&2
  exit 1
fi

echo "削除と作り直しは含まれていない"
