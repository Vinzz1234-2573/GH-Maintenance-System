import { redirect } from "next/navigation";

// Old name-only login URL — keep bookmarks working.
export default function StaffLoginRedirect() {
  redirect("/login");
}
