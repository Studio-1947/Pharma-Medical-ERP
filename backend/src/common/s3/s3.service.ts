import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage } from "@google-cloud/storage";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly storage: Storage | null;
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>("S3_ENDPOINT")?.trim();
    this.s3 = endpoint
      ? new S3Client({
          region: this.config.get<string>("S3_REGION") || "us-east-1",
          endpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: this.config.get<string>("S3_ACCESS_KEY") || "minioadmin",
            secretAccessKey: this.config.get<string>("S3_SECRET_KEY") || "minioadmin",
          },
        })
      : null;
    this.storage = this.s3 ? null : new Storage();
    this.bucket = this.config.get("S3_BUCKET") || "pharmerp";
  }

  async onModuleInit() {
    if (this.s3) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        try {
          await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
          this.logger.log(`Created S3/MinIO bucket: ${this.bucket}`);
        } catch (err) {
          this.logger.warn(`Could not ensure S3/MinIO bucket: ${(err as Error).message}`);
        }
      }
      return;
    }
    try {
      const [exists] = await this.storage!.bucket(this.bucket).exists();
      if (!exists) {
        this.logger.warn(`GCS bucket ${this.bucket} does not exist`);
      } else {
        this.logger.log(`GCS bucket ${this.bucket} ready`);
      }
    } catch (err) {
      this.logger.warn(`Could not verify GCS bucket: ${(err as Error).message}`);
    }
  }

  async upload(file: Buffer, key: string, contentType: string): Promise<string> {
    try {
      if (this.s3) {
        await this.s3.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
        }));
        return key;
      }
      const gcsFile = this.storage!.bucket(this.bucket).file(key);
      await gcsFile.save(file, { contentType, resumable: false });
      return key;
    } catch (error) {
      this.logger.error(`Failed to upload to GCS: ${(error as Error).message}`);
      throw error;
    }
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      if (this.s3) {
        return getSignedUrl(
          this.s3,
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
          { expiresIn },
        );
      }
      const [url] = await this.storage!
        .bucket(this.bucket)
        .file(key)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + expiresIn * 1000,
        });
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL: ${(error as Error).message}`);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      if (this.s3) {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        return;
      }
      await this.storage!.bucket(this.bucket).file(key).delete();
    } catch (error) {
      this.logger.error(`Failed to delete from GCS: ${(error as Error).message}`);
      throw error;
    }
  }
}
