import { buildConfig } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || "claudemesh-dev-secret-change-in-production",

  admin: {
    user: "users",
    meta: {
      titleSuffix: "— claudemesh",
    },
  },

  editor: lexicalEditor(),

  db: sqliteAdapter({
    client: {
      url: process.env.PAYLOAD_DATABASE_URI || path.resolve(dirname, "payload.db"),
    },
  }),

  sharp,

  collections: [
    // --- Users (admin panel) ---
    {
      slug: "users",
      auth: true,
      admin: { useAsTitle: "email" },
      fields: [
        { name: "name", type: "text" },
        { name: "role", type: "select", options: ["admin", "editor"], defaultValue: "editor" },
      ],
    },

    // --- Media ---
    {
      slug: "media",
      upload: {
        staticDir: path.resolve(dirname, "public/media"),
        mimeTypes: ["image/*"],
      },
      admin: { useAsTitle: "alt" },
      fields: [
        { name: "alt", type: "text", required: true },
      ],
    },

    // --- Authors ---
    {
      slug: "authors",
      admin: { useAsTitle: "name" },
      fields: [
        { name: "name", type: "text", required: true },
        { name: "slug", type: "text", required: true, unique: true },
        { name: "bio", type: "textarea" },
        { name: "role", type: "text" },
        {
          name: "avatar",
          type: "upload",
          relationTo: "media",
        },
        {
          name: "links",
          type: "group",
          fields: [
            { name: "github", type: "text" },
            { name: "twitter", type: "text" },
            { name: "website", type: "text" },
          ],
        },
      ],
    },

    // --- Categories ---
    {
      slug: "categories",
      admin: { useAsTitle: "name" },
      fields: [
        { name: "name", type: "text", required: true },
        { name: "slug", type: "text", required: true, unique: true },
        { name: "description", type: "textarea" },
      ],
    },

    // --- Blog Posts ---
    {
      slug: "posts",
      admin: {
        useAsTitle: "title",
        defaultColumns: ["title", "status", "publishedAt", "author"],
      },
      versions: { drafts: true },
      fields: [
        { name: "title", type: "text", required: true },
        {
          name: "slug",
          type: "text",
          required: true,
          unique: true,
          admin: {
            position: "sidebar",
            description: "URL-friendly identifier. Auto-generated from title if left blank.",
          },
        },
        {
          name: "excerpt",
          type: "textarea",
          admin: { description: "1-2 sentence summary for cards and meta descriptions." },
        },
        {
          name: "content",
          type: "richText",
          required: true,
        },
        {
          name: "coverImage",
          type: "upload",
          relationTo: "media",
        },
        {
          name: "author",
          type: "relationship",
          relationTo: "authors",
          required: true,
        },
        {
          name: "categories",
          type: "relationship",
          relationTo: "categories",
          hasMany: true,
        },
        {
          name: "publishedAt",
          type: "date",
          admin: { position: "sidebar", date: { pickerAppearance: "dayOnly" } },
        },
        {
          name: "status",
          type: "select",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Published", value: "published" },
          ],
          defaultValue: "draft",
          admin: { position: "sidebar" },
        },
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "metaTitle", type: "text" },
            { name: "metaDescription", type: "textarea" },
            { name: "ogImage", type: "upload", relationTo: "media" },
          ],
        },
      ],
    },

    // --- Changelog ---
    {
      slug: "changelog",
      admin: {
        useAsTitle: "version",
        defaultColumns: ["version", "date", "type"],
      },
      fields: [
        { name: "version", type: "text", required: true },
        { name: "date", type: "date", required: true },
        {
          name: "type",
          type: "select",
          options: [
            { label: "Feature", value: "feat" },
            { label: "Fix", value: "fix" },
            { label: "Docs", value: "docs" },
            { label: "Breaking", value: "breaking" },
          ],
          required: true,
        },
        { name: "summary", type: "text", required: true },
        { name: "body", type: "richText" },
        { name: "npmUrl", type: "text" },
        { name: "githubUrl", type: "text" },
      ],
    },
  ],

  typescript: {
    outputFile: path.resolve(dirname, "src/payload-types.ts"),
  },
});
