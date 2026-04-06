import { redirect } from "next/navigation";

// Payload admin panel disabled in production (standalone output
// doesn't support Payload's server init). Content managed via
// local dev server or API.
export default function PayloadAdminRedirect() {
  redirect("/");
}
