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
find "${package_dir}" -name "__pycache__" -type d -prune -exec rm -rf {} +

(cd "${package_dir}" && zip -q -r "${build_dir}/lambda.zip" .)

echo "${build_dir}/lambda.zip"
