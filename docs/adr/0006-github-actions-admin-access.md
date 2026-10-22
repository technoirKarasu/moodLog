# 0006 GitHub Actions用IAMロールの権限をAdministratorAccessにする

## 状況

Terraformの実行基盤（Issue #7）で、GitHub ActionsがOIDC経由でAssumeするIAMロールを作る際、付与する権限の範囲を検討した。デプロイ対象（S3、CloudFront、Lambda、API Gateway、RDS、SSM、IAMなど）に必要な権限を都度洗い出して最小権限ポリシーを作るか、ひとまず広い権限を与えて後で絞るかの選択。

## 決定

初期段階は `AdministratorAccess` を付与する。デプロイに必要な権限が実際に固まった時点で最小権限へ絞る。

## 捨てた選択肢

最初から最小権限のカスタムポリシーを作る。デプロイ対象のAWSリソースがこれから頻繁に増える段階で、都度ポリシーを更新するコストが、個人開発の初期段階で得られるメリットより大きいと判断した。

## 結果

`infra/oidc.tf` の `aws_iam_role_policy_attachment.github_actions_admin` で付与済み（Issue #7）。IAMロールの信頼ポリシー（`sub` 条件）で、mainブランチへのpushのワークフローのみがこのロールをAssumeできるよう制限しているが、権限範囲自体はAWS操作のほぼ全てを許可する状態のまま。

見直しの目安: Issue #14（GitHub ActionsでCI/CDを構築する）で実際に必要なデプロイ操作が確定した時点で、最小権限ポリシーに絞る。

Issue #76 で、main マージ時のデプロイ（ADR 0012）にこのロールを使い始めた。必要な操作はここで決まったが、tfstate のバケットを東京へ移す（Issue #25）のを先に行うため、権限は AdministratorAccess のまま。Issue #83 で、ADR 0012 のデプロイに必要な範囲に絞る。
