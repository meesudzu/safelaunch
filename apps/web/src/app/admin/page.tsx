import { redirect } from "next/navigation";

// `/admin` has no body of its own — it is the entry point to the
// admin console. Cloudflare Access sits in front of every `/admin/*`
// path (see `scripts/setup-cloudflare-access.sh`) so this redirect is
// only reached by already-authenticated reviewers (or by anyone if
// Access is misconfigured); both cases land on the legal queue.
export default function AdminIndex(): never {
  redirect("/admin/legal");
}
