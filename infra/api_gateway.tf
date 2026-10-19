# Lambda（FastAPI）を公開URLで呼べるようにするAPI Gateway（HTTP API）。
# Issue #10: Lambda + API GatewayをTerraformで構築する
#
# すべてのパスとメソッドを $default ルートでLambdaに渡し、ルーティングはFastAPI側で行う。
# Issue #59: $default ルートにJWTオーソライザーを付け、ログインしていないと呼べないようにする。
# 新しいAPIを足したときに認証なしで公開しないよう、認証なしのルートだけを個別に作る（/health とプリフライト）。

resource "aws_apigatewayv2_api" "api" {
  name          = "moodlog-api"
  protocol_type = "HTTP"

  # ブラウザ（frontend）から呼べるようにする。事前確認（OPTIONS）もAPI Gatewayが返し、Lambdaは呼ばれない。
  # 許可するオリジン:
  # - CloudFrontの公開URL（Issue #12）
  # - http://localhost:3000: ローカル開発用（Issue #11）。本番のAPIにも効くが、トークンはクッキーではなく
  #   Authorizationヘッダーで送るため、許可するオリジンが増えてもトークンが漏れるわけではない。そのため残す（Issue #59）
  cors_configuration {
    allow_origins = [
      "https://${aws_cloudfront_distribution.frontend.domain_name}",
      "http://localhost:3000",
    ]
    # 今のAPIは GET だけ
    allow_methods = ["GET"]
    # アクセストークンを送るため
    allow_headers = ["authorization"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# Cognitoのトークンを検証する。アクセストークンには aud がないため、client_id を audience として照合する
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://${aws_cognito_user_pool.main.endpoint}"
    audience = [aws_cognito_user_pool_client.frontend.id]
  }
}

resource "aws_apigatewayv2_route" "default" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# 動作確認用に、ログインしなくても呼べるようにする
resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# $default はOPTIONSも受けるため、そのままではプリフライトにもトークンが求められて失敗する。
# 認証なしのOPTIONSルートを作る（API Gatewayのドキュメント「HTTP APIのCORSの設定」の、$default で認可を使う場合の手順）。
# CORSを設定しているので、プリフライトにはAPI Gatewayが答え、Lambdaは呼ばれない
resource "aws_apigatewayv2_route" "preflight" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "OPTIONS /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  # /health は認証なしで呼べ、リクエストのたびにDBへ接続するため、料金とRDSの同時接続数を守る
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 10
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowInvokeFromApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
