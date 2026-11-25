import { z } from "zod";

/** Client-side checks that mirror the backend's LoginDto limits, with friendly messages. */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address")
    .pipe(z.email("Enter a valid email address").max(254, "That email address is too long")),
  password: z.string().min(1, "Enter your password").max(128, "That password is too long"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
