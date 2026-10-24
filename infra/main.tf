terraform {
  backend "s3" {
    bucket       = "moodlog-tfstate-96-tokyo"
    key          = "moodlog/terraform.tfstate"
    region       = "ap-northeast-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-northeast-1"
}
