terraform {
  backend "s3" {
    bucket       = "moodlog-tfstate-96"
    key          = "moodlog/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-southeast-2"
}
