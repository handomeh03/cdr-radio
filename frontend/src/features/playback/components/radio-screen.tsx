import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { RadioPlayer } from "./radio-player";

/** The public listening page. No sign-in, no admin controls. */
export function RadioScreen() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-8 sm:py-12">
      <header className="space-y-1 text-center">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">CDR Central Radio</h1>
        <p className="text-sm text-muted-foreground">One live station for every CDR Group and Ghammas Baladi branch.</p>
      </header>

      <Card>
        <CardContent>
          <RadioPlayer />
        </CardContent>
      </Card>

      <footer className="text-center text-xs text-muted-foreground">
        <Link href="/login" className="underline-offset-4 hover:underline focus-visible:underline">
          Staff sign in
        </Link>
      </footer>
    </main>
  );
}
