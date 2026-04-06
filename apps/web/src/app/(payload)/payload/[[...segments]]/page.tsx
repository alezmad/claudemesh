import { redirect } from "next/navigation";

// Payload admin disabled in production standalone output.
// Use local dev server for CMS admin.
export default function PayloadAdminRedirect() {
  redirect("/");
}
