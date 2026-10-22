#!/usr/bin/env bash
# Lambda（Python 3.13 / arm64）にデプロイするzipを作る。
# Issue #10: 出来た backend/build/lambda.zip を infra/lambda.tf が参照する
#
# 使い方: リポジトリのどこからでも `backend/scripts/build_lambda.sh` を実行する
set -euo pipefail

backend_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="${backend_dir}/build"
package_dir="${build_dir}/lambda"

rm -rf "${build_dir}"
mkdir -p "${package_dir}"

# 手元のOSに関係なく、Lambdaの実行環境（Linux / arm64）向けのwheelを入れる。
# python3.13ランタイムはAmazon Linux 2023（glibc 2.34）なので、manylinux_2_28 のwheelも使える
# （psycopg2-binary 2.9.13 は manylinux2014 のarm64向けwheelを出していない）
python3 -m pip install \
  --quiet \
  --requirement "${backend_dir}/requirements.txt" \
  --target "${package_dir}" \
  --platform manylinux2014_aarch64 \
  --platform manylinux_2_28_aarch64 \
  --python-version 3.13 \
  --implementation cp \
  --only-binary=:all:

cp -R "${backend_dir}/app" "${package_dir}/app"
# マイグレーション用のLambda（app/migrate.py、Issue #58）が使う。
# ライブラリのalembicがルートの alembic/ に入るため、マイグレーションは migrations/ に置いている
cp -R "${backend_dir}/migrations" "${package_dir}/migrations"
cp "${backend_dir}/alembic.ini" "${package_dir}/alembic.ini"
find "${package_dir}" -name "__pycache__" -type d -prune -exec rm -rf {} +

# コードが同じなら、毎回同じハッシュのzipにする（Issue #76）。
# ハッシュが変わると、main マージ時のデプロイのたびに3つのLambdaが更新されるため。
# 更新時刻・パーミッション（umaskで変わらないよう、実行権限の有無だけを残す）・並び順をそろえ、
# zip固有の追加の属性を入れない（-X）。
# 手元（macOS）と CI（Ubuntu）では zip の版が違うため、同じハッシュにはならない（docs/adr/0012-deploy.md）
find "${package_dir}" -exec touch -h -t 198001010000 {} +
chmod -R u=rwX,go=rX "${package_dir}"
(cd "${package_dir}" && find . -mindepth 1 | LC_ALL=C sort | zip -q -X -@ "${build_dir}/lambda.zip")

echo "${build_dir}/lambda.zip"
