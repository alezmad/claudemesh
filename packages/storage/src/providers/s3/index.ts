import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as getSignedUrlCommand } from "@aws-sdk/s3-request-presigner";

import { getObjectUrlSchema } from "../../lib/schema";

import { getClient } from "./client";

import type { GetObjectUrlInput } from "../../lib/schema";
import type { StorageProviderStrategy } from "../types";

// Helper to apply schema defaults (bucket from env)
const withDefaults = (input: GetObjectUrlInput) => getObjectUrlSchema.parse(input);

export const { getUploadUrl, getSignedUrl, getPublicUrl, getDeleteUrl } = {
  getUploadUrl: async (input: GetObjectUrlInput) => {
    const { path, bucket } = withDefaults(input);
    const client = getClient();

    const url = await getSignedUrlCommand(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: path,
      }),
      {
        expiresIn: 60,
      },
    );

    return { url };
  },
  getSignedUrl: async (input: GetObjectUrlInput) => {
    const { path, bucket } = withDefaults(input);
    const client = getClient();

    const url = await getSignedUrlCommand(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: path,
      }),
      {
        expiresIn: 3600,
      },
    );

    return { url };
  },
  getPublicUrl: async (input: GetObjectUrlInput) => {
    const { path, bucket } = withDefaults(input);
    const client = getClient();
    const endpoint = await client.config.endpoint?.();
    const forcePathStyle = client.config.forcePathStyle;

    if (endpoint?.hostname.includes("supabase.co")) {
      return {
        url: `${endpoint.protocol}//${endpoint.hostname}/storage/v1/object/public/${bucket}/${path}`,
      };
    }

    // Use path-style URL for MinIO and other S3-compatible storage (forcePathStyle: true)
    if (forcePathStyle) {
      const port = endpoint?.port ? `:${endpoint.port}` : "";
      return {
        url: `${endpoint?.protocol}//${endpoint?.hostname}${port}/${bucket}/${path}`,
      };
    }

    return {
      url: `${endpoint?.protocol}//${bucket}.${endpoint?.hostname}/${path}`,
    };
  },
  getDeleteUrl: async (input: GetObjectUrlInput) => {
    const { path, bucket } = withDefaults(input);
    const client = getClient();

    const url = await getSignedUrlCommand(
      client,
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: path,
      }),
      {
        expiresIn: 60,
      },
    );

    return { url };
  },
} satisfies StorageProviderStrategy;
