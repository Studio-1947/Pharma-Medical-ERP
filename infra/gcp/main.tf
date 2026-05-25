terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
  backend "gcs" {
    bucket = "radha-madhav-tfstate"
    prefix = "prod"
  }
}

provider "google" {
  project = "radha-madhav-497409"
  region  = "asia-south1"
}

resource "google_artifact_registry_repository" "main" {
  location      = "asia-south1"
  repository_id = "pharmerp"
  format        = "DOCKER"
}

resource "google_compute_global_address" "private_ip_range" {
  name          = "pharmerp-private-ip-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = "default"
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = "default"
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

resource "google_sql_database_instance" "postgres" {
  name                = "pharmerp-prod"
  database_version    = "POSTGRES_16"
  region              = "asia-south1"
  deletion_protection = true

  depends_on = [google_service_networking_connection.private_vpc_connection]

  settings {
    tier = "db-f1-micro"
    ip_configuration {
      ipv4_enabled    = false
      private_network = "projects/radha-madhav-497409/global/networks/default"
    }
    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
    }
  }
}

resource "google_sql_database" "pharmerp" {
  name     = "pharmerp"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "pharmerp" {
  name     = "pharmerp"
  instance = google_sql_database_instance.postgres.name
  password = var.db_password
}

resource "google_vpc_access_connector" "main" {
  name          = "pharmerp-connector"
  region        = "asia-south1"
  network       = "default"
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 3
  machine_type  = "f1-micro"
}

resource "google_redis_instance" "main" {
  name               = "pharmerp-redis"
  tier               = "BASIC"
  memory_size_gb     = 1
  region             = "asia-south1"
  redis_version      = "REDIS_7_0"
  authorized_network = "default"
}

resource "google_storage_bucket" "files" {
  name                        = "radha-madhav-prod-files"
  location                    = "ASIA-SOUTH1"
  force_destroy               = false
  uniform_bucket_level_access = true
}



output "cloud_sql_ip" {
  value = google_sql_database_instance.postgres.private_ip_address
}

output "redis_host" {
  value = google_redis_instance.main.host
}

output "artifact_registry" {
  value = google_artifact_registry_repository.main.id
}

variable "db_password" {
  sensitive = true
}