# GCP Deployment Troubleshooting Guide

## Issues Encountered

### 1. SQL Database Instance Failure
**Error:** `SERVICE_NETWORKING_NOT_ENABLED`
**Resource:** `google_sql_database_instance.postgres`

**Cause:** Private Google Access is not enabled on the VPC network used by Cloud SQL.

**Solution:**
```bash
# Enable private Google access on your VPC network
gcloud compute networks subnets update <subnet-name> \
    --region <region> \
    --enable-private-ip-google-access
```

Alternatively, in `main.tf`, add this configuration:
```hcl
resource "google_sql_database_instance" "postgres" {
  # ... existing config ...
  
  settings {
    ip_configuration {
      private_network = google_compute_network.main.id
      require_ssl     = true
      
      # Add this for private service access
      ipv4_enabled       = false
      private_network    = google_compute_network.main.id
      database_version   = "POSTGRES_15"
      
      # Enable private service access
      public_ip          = false
    }
  }
}
```

---

### 2. VPC Access Connector Failure
**Error:** `Serverless VPC Access API has not been used in project radha-madhav-497409 before or it is disabled`
**Resource:** `google_vpc_access_connector.main`

**Cause:** The Serverless VPC Access API is not enabled in your GCP project.

**Solution:**

**Option A - Via Console:**
1. Visit: https://console.developers.google.com/apis/api/vpcaccess.googleapis.com/overview?project=radha-madhav-497409
2. Click "Enable"

**Option B - Via CLI:**
```bash
gcloud services enable vpcaccess.googleapis.com --project=radha-madhav-497409
```

---

### 3. Redis Instance Failure
**Error:** `Google Cloud Memorystore for Redis API has not been used in project radha-madhav-497409 before or it is disabled`
**Resource:** `google_redis_instance.main`

**Cause:** The Google Cloud Memorystore for Redis API is not enabled.

**Solution:**

**Option A - Via Console:**
1. Visit: https://console.developers.google.com/apis/api/redis.googleapis.com/overview?project=radha-madhav-497409
2. Click "Enable"

**Option B - Via CLI:**
```bash
gcloud services enable redis.googleapis.com --project=radha-madhav-497409
```

---

### 4. Cloud Run Service Failure
**Error:** `Image 'asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/frontend:latest' not found`
**Resource:** `google_cloud_run_v2_service.frontend`

**Cause:** The Docker image referenced in Cloud Run does not exist in Artifact Registry.

**Solution:**

**Step 1 - Build and Push the Docker Image:**
```bash
# Authenticate Docker with GCP
gcloud auth configure-docker asia-south1-docker.pkg.dev

# Build the Docker image
docker build -t asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/frontend:latest ./frontend

# Push the image to Artifact Registry
docker push asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/frontend:latest
```

**Step 2 - Verify Image Exists:**
```bash
# List images in Artifact Registry
gcloud artifacts docker images list radha-madhav-497409 asia-south1 pharmerp
```

---

## Complete Setup Script

Run this script to enable all required APIs and deploy:

```bash
#!/bin/bash
# setup-and-deploy.sh

PROJECT_ID="radha-madhav-497409"

echo "=== Enabling Required APIs ==="
gcloud services enable sqladmin.googleapis.com --project=$PROJECT_ID
gcloud services enable vpcaccess.googleapis.com --project=$PROJECT_ID
gcloud services enable redis.googleapis.com --project=$PROJECT_ID
gcloud services enable run.googleapis.com --project=$PROJECT_ID
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
gcloud services enable compute.googleapis.com --project=$PROJECT_ID

echo "=== Waiting for APIs to propagate (30 seconds) ==="
sleep 30

echo "=== Building and Pushing Frontend Image ==="
cd frontend
gcloud auth configure-docker asia-south1-docker.pkg.dev
docker build -t asia-south1-docker.pkg.dev/$PROJECT_ID/pharmerp/frontend:latest .
docker push asia-south1-docker.pkg.dev/$PROJECT_ID/pharmerp/frontend:latest
cd ..

echo "=== Running Terraform Apply ==="
cd infra/gcp
terraform init
terraform apply -auto-approve

echo "=== Deployment Complete ==="
```

---

## Quick Fix Commands

Execute these commands in order:

```bash
# 1. Enable all required APIs
gcloud services enable sqladmin.googleapis.com vpcaccess.googleapis.com redis.googleapis.com run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com compute.googleapis.com --project=radha-madhav-497409

# 2. Wait for API propagation
sleep 60

# 3. Build and push Docker image
cd frontend
gcloud auth configure-docker asia-south1-docker.pkg.dev
docker build -t asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/frontend:latest .
docker push asia-south1-docker.pkg.dev/radha-madhav-497409/pharmerp/frontend:latest
cd ..

# 4. Update subnet if needed (replace with your subnet name and region)
gcloud compute networks subnets update default --region=asia-south1 --enable-private-ip-google-access

# 5. Re-run Terraform
cd infra/gcp
terraform apply -auto-approve
```

---

## Verification Steps

After deployment, verify resources:

```bash
# Check SQL Instance
gcloud sql instances list --project=radha-madhav-497409

# Check Redis Instance
gcloud redis instances list --region=asia-south1

# Check VPC Connector
gcloud vpc access connectors list --region=asia-south1

# Check Cloud Run Service
gcloud run services list --region=asia-south1

# Check Artifact Registry
gcloud artifacts repositories describe pharmerp --location=asia-south1
```
