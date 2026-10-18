# RDSとLambdaを置くためのVPC。
# Issue #36: デフォルトVPCに頼らず、ネットワークをTerraformの管理下に置く（docs/adr/0007-vpc.md参照）
#
# プライベートサブネットだけの最小構成。インターネットゲートウェイとNATゲートウェイは作らない。
# そのため、VPC内のリソースからインターネットやSSMなどのAWSサービスへは出られない。
# Lambdaには接続情報をデプロイ時に環境変数で渡すため、外向きの経路は作らない（docs/adr/0007-vpc.md）。

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"

  # VPC内からRDSのエンドポイント名を引けるようにする
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "moodlog"
  }
}

# RDSのサブネットグループには2つ以上のAZのサブネットが必要なため、1aと1cに1つずつ置く
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "ap-northeast-1a"

  tags = {
    Name = "moodlog-private-a"
  }
}

resource "aws_subnet" "private_c" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "ap-northeast-1c"

  tags = {
    Name = "moodlog-private-c"
  }
}
