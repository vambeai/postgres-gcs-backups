import { Storage, UploadOptions } from "@google-cloud/storage";
import { exec } from "child_process";
import { mkdir, unlink } from "fs/promises";
import path from "path";

import { env } from "./env";

const uploadToGCS = async ({ name, path }: { name: string; path: string }) => {
  console.log("Uploading backup to GCS...");

  const bucketName = env.GCS_BUCKET;

  const uploadOptions: UploadOptions = {
    destination: name,
  };

  const storage = new Storage({
    projectId: env.GOOGLE_PROJECT_ID,
    credentials: JSON.parse(env.SERVICE_ACCOUNT_JSON),
  });

  await storage.bucket(bucketName).upload(path, uploadOptions);

  console.log("Backup uploaded to GCS...");
};

const ensureDirectoryExists = async (filePath: string) => {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
};

const dumpToFile = async (filePath: string) => {
  console.log("Dumping DB to file...");

  await ensureDirectoryExists(filePath);

  return new Promise((resolve, reject) => {
    // Use pg_dumpall instead of pg_dump to avoid version mismatch issues
    const command = `pg_dumpall -h viaduct.proxy.rlwy.net -p 57886 -U postgres | gzip > ${filePath}`;
    exec(
      command,
      { env: { ...process.env, PGPASSWORD: env.DB_PASSWORD } },
      (error, stdout, stderr) => {
        if (error) {
          reject({ error: JSON.stringify(error), stderr });
          return;
        }
        resolve(stdout);
      }
    );
  });
};

const deleteFile = async (path: string) => {
  console.log("Deleting file...");
  await new Promise((resolve, reject) => {
    unlink(path, (err) => {
      if (err) {
        reject({ error: JSON.stringify(err) });
        return;
      }
      resolve(undefined);
    });
  });
};

export const backup = async () => {
  try {
    console.log("Initiating DB backup...");

    let date = new Date().toISOString();
    const timestamp = date.replace(/[:.]+/g, "-");
    const filename = `backup-${timestamp}.sql.gz`;
    const filepath = `/tmp/bucket-ai/${filename}`;

    console.log(`Dumping to file: ${filepath}`);
    await dumpToFile(filepath);

    console.log(`Uploading file: ${filename}`);
    await uploadToGCS({ name: filename, path: filepath });

    console.log(`Deleting file: ${filepath}`);
    await deleteFile(filepath);

    console.log("DB backup complete...");
  } catch (error) {
    console.error("Backup failed:", error);
  }
};
