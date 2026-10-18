# PostgreSQL本体（RDS）と、接続情報の管理（SSM Parameter Store）。
# Issue #9: DBとシークレット管理をTerraformで構築する
#
# ネットワークは専用VPCを新たに作らず、AWSアカウント標準のデフォルトVPCを使う。
# 個人開発の初期段階でネットワーク構成を複雑にしないための判断（docs/adr/0002-database.md参照）。

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_db_subnet_group" "moodlog" {
  name       = "moodlog-db"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name        = "moodlog-db"
  description = "RDS(PostgreSQL)への接続許可範囲"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "デフォルトVPC内からのPostgreSQL接続を許可。Lambdaも同VPCに配置する想定（Issue #10）"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# マスターパスワードをコードに書かず、Terraformに生成させてSSMにのみ保存する
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "moodlog" {
  identifier = "moodlog"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = "moodlog"
  username = "moodlog"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.moodlog.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/moodlog/database_url"
  type  = "SecureString"
  value = "postgresql+psycopg2://${aws_db_instance.moodlog.username}:${random_password.db.result}@${aws_db_instance.moodlog.endpoint}/${aws_db_instance.moodlog.db_name}"
}
