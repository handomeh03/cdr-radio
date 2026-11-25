import type { Metadata } from "next";
import { LoginScreen } from "@/features/auth/components/login-screen";

export const metadata: Metadata = { title: "Sign in · CDR Central Radio" };

export default function LoginPage() {
  return <LoginScreen />;
}
