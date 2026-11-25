import { redirect } from "next/navigation";

// The public player is the home page: branches open one link and press Play.
export default function Home() {
  redirect("/radio");
}
