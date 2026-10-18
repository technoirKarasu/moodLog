#!/usr/bin/env bash
# フロントエンドをビルドし、S3にアップロードして、CloudFrontのキャッシュを消す。
# Issue #12: 公開URL（CloudFront）で表示する
#
# 使い方: リポジトリのどこからでも `frontend/scripts/deploy.sh` を実行する。
# 前提: infra を apply 済みで、terraform output と aws CLI が使えること
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
frontend_dir="${repo_dir}/frontend"

tf_output() {
  terraform -chdir="${repo_dir}/infra" output -raw "$1"
}

api_endpoint="$(tf_output api_endpoint)"
bucket="$(tf_output frontend_bucket_name)"
distribution_id="$(tf_output frontend_distribution_id)"

# NEXT_PUBLIC_API_BASE_URL はビルド時に埋め込まれる（.env.local より環境変数が優先される）
(cd "${frontend_dir}" && NEXT_PUBLIC_API_BASE_URL="${api_endpoint}" npm run build)

# out/ にないファイルはS3からも消す
aws s3 sync "${frontend_dir}/out/" "s3://${bucket}/" --delete --only-show-errors

aws cloudfront create-invalidation \
  --distribution-id "${distribution_id}" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text

echo "$(tf_output frontend_url)"
