# 0011 本番DBへのマイグレーションは、VPC内の専用Lambdaから流す

## 状況

RDSはプライベートサブネットにあり、インターネットへの出入り口がない（ADR 0007）。そのため、手元のPCから本番DBに `alembic upgrade head` を実行できない。日次の記録（#66）で最初のテーブルを作る前に、本番DBへマイグレーションを流す方法を決める必要があった（Issue #58）。

## 決定

- マイグレーション専用のLambda（`moodlog-migrate`、`infra/migrate.tf`）を、APIのLambdaと同じVPCのプライベートサブネットに置く。手元から `aws lambda invoke` で呼び、`alembic upgrade head` を流す。CI/CD（#14）でも同じ方法で呼ぶ
- APIと同じzipを使い、ハンドラー（`app/migrate.py`）だけを変える。接続文字列も、APIと同じくSSMの値をデプロイ時に環境変数で渡す
- 成功したら適用後のリビジョンを `{"revision": "..."}` で返し、失敗したら例外を投げる。`aws lambda invoke` は関数が失敗しても終了コード0を返すため、失敗はレスポンスの `FunctionError` で判定する
- 同じマイグレーションが並行して流れないよう、Lambdaの同時実行を1つに予約する（`reserved_concurrent_executions = 1`）。あわせて、CLIの読み取りタイムアウト（既定60秒）による呼び直しを防ぐため、`--cli-read-timeout 0` を付けて呼ぶ
- API Gateway や EventBridge からは呼べるようにしない。呼べるのは、`lambda:InvokeFunction` の権限を持つ IAM のユーザーとロールだけ
- zipでは、pipが入れるライブラリのalembicがルートの `alembic/` に入る。ぶつからないよう、マイグレーションのディレクトリを `backend/alembic/` から `backend/migrations/` に改名した
- ダウングレードは本番では流さない。戻すときは、戻すためのマイグレーションを新しく作って流す

## 捨てた選択肢

- 踏み台（EC2）や SSM Session Manager のポートフォワードで、手元からつなぐ: EC2の常時起動の費用（または毎回の起動・停止）と、OSの更新などの運用が増える
- RDSをパブリックにして、手元のIPだけ許可する: DBをインターネットに出すことになり、ADR 0007 の方針に反する
- CodeBuild をVPC内で動かす: サービスが1つ増える。CI/CD からは、このLambdaを呼べば足りる
- APIのLambdaの起動時（コールドスタート）に流す: 同時に起動した複数のLambdaが並行して流しうる。起動も遅くなる
- APIのLambdaに、マイグレーション用のパスを足す: 公開しているAPIからスキーマを変えられるようになる
- zipの中だけ、マイグレーションを別のディレクトリに置く: リポジトリとzipで `alembic.ini` の位置が変わり、手元のテストでzipと同じ読み方を確かめにくい

## 結果

`infra/migrate.tf` で構築し、空のマイグレーション（`5bd71c859282`）を本番DBに適用した（Issue #58）。2回目に流しても同じリビジョンが返り、マイグレーションは流れなかった。
