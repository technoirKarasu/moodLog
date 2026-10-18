# フロントエンド（Next.jsの静的エクスポート）を配信するS3とCloudFront。
# Issue #12: S3 + CloudFrontをTerraformで構築する（docs/adr/0005-frontend-hosting.md参照）
#
# S3は非公開にし、CloudFront（Origin Access Control）経由でだけ読めるようにする。
# ファイルのアップロードは frontend/scripts/deploy.sh で行う（Terraformではファイルを管理しない）。

data "aws_caller_identity" "current" {}

# S3のバケット名は全世界で一意なため、AWSアカウントIDを付ける
resource "aws_s3_bucket" "frontend" {
  bucket = "moodlog-frontend-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "moodlog-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWSのマネージドキャッシュポリシー
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  # 日本のエッジを含む（PriceClass_100 は北米・欧州だけ）
  price_class = "PriceClass_200"

  origin {
    origin_id                = "frontend-s3"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "frontend-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }

  # OACでは、存在しないオブジェクトにS3が403を返すため、404と合わせて 404.html（Next.jsが出力する）を404で返す
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 404
    response_page_path = "/404.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# このディストリビューションからの読み取りだけを許可する
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })

  # 公開アクセスブロックを先に設定してから、ポリシーを付ける
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
