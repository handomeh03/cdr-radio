import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-heading text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist.</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to the home page
      </Link>
    </main>
  );
}
