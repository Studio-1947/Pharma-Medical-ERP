import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Storage } from "@google-cloud/storage";

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly storage: Storage;
  private readonly bucket: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly config: ConfigService) {
    this.storage = new Storage();
    this.bucket = this.config.get("S3_BUCKET") || "pharmerp";
  }

  async onModuleInit() {
    try {
      const [exists] = await this.storage.bucket(this.bucket).exists();
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
      const gcsFile = this.storage.bucket(this.bucket).file(key);
      await gcsFile.save(file, { contentType, resumable: false });
      return key;
    } catch (error) {
      this.logger.error(`Failed to upload to GCS: ${(error as Error).message}`);
      throw error;
    }
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    try {
      const [url] = await this.storage
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
      await this.storage.bucket(this.bucket).file(key).delete();
    } catch (error) {
      this.logger.error(`Failed to delete from GCS: ${(error as Error).message}`);
      throw error;
    }
  }
}
