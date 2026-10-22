# PostgreSQL本体（RDS）と、接続情報の管理（SSM Parameter Store）。
# Issue #9: DBとシークレット管理をTerraformで構築する
#
# ネットワークは network.tf で作るVPCのプライベートサブネットに置く（docs/adr/0007-vpc.md参照）。

resource "aws_db_subnet_group" "moodlog" {
  name       = "moodlog-db"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]
}

# RDS(PostgreSQL)への接続許可範囲
# セキュリティグループのdescriptionに使える文字はAWS側で英数字と一部の記号に限られるため、英語で書く
resource "aws_security_group" "db" {
  name        = "moodlog-db"
  description = "Allowed access to RDS (PostgreSQL)"
  vpc_id      = aws_vpc.main.id

  ingress {
    # VPC内からのPostgreSQL接続を許可。Lambdaも同じVPCに置く想定（Issue #10）
    # ルールのdescriptionに使える文字はAWS側で英数字と一部の記号に限られるため、英語で書く
    description = "PostgreSQL from within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
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

  # 誤って消したり作り直したりして、記録を失わないようにする（Issue #82）。
  # 削除保護を付けると、Terraform・コンソール・CLI のどこから消そうとしても AWS が拒む。
  # 消すときの手順は infra/README.md の「データを持つリソースを消すとき・作り直すとき」
  deletion_protection = true
  # 削除保護を外して消したときも、最後のスナップショットを残す。
  # 名前に日時を入れると plan のたびに差分が出るため、固定にする
  skip_final_snapshot       = false
  final_snapshot_identifier = "moodlog-final"
}

resource "aws_ssm_parameter" "database_url" {
  name  = "/moodlog/database_url"
  type  = "SecureString"
  value = "postgresql+psycopg2://${aws_db_instance.moodlog.username}:${random_password.db.result}@${aws_db_instance.moodlog.endpoint}/${aws_db_instance.moodlog.db_name}"
}
