import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly config: ConfigService) {
    this.client = new S3Client({
      region: "us-east-1",
      endpoint: this.config.get("S3_ENDPOINT") || "http://localhost:9000",
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get("S3_ACCESS_KEY") || "minioadmin",
        secretAccessKey: this.config.get("S3_SECRET_KEY") || "minioadmin",
      },
    });
    this.bucket = this.config.get("S3_BUCKET") || "pharmerp";
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created S3 bucket: ${this.bucket}`);
      } catch (createErr) {
        this.logger.warn(`Could not ensure S3 bucket exists: ${(createErr as Error).message}`);
      }
    }
  }

  async upload(
    file: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
        }),
      );
      return key;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to upload to S3: ${err.message}`);
      throw error;
    }
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to generate signed URL: ${err.message}`);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to delete from S3: ${err.message}`);
      throw error;
    }
  }
}
