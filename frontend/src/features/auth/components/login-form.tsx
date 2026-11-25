"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getErrorMessage, isUnauthorized } from "@/lib/api-error";
import { useAuth } from "@/store/auth-context";
import { loginSchema, type LoginFormValues } from "../schemas/login.schema";

/** Email + password form. On success the session becomes "authenticated" and the screen redirects. */
export function LoginForm() {
  const { login } = useAuth();
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
      toast.success("Signed in");
    } catch (error) {
      setError("root", { message: getErrorMessage(error, "Could not sign in. Please try again.") });
      if (isUnauthorized(error)) {
        resetField("password");
        setFocus("password");
      }
    }
  });

  return (
    // noValidate: Zod validates, so the browser's own bubbles don't compete with our messages.
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {errors.root && (
          <InlineAlert>{errors.root.message}</InlineAlert>
        )}

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>

        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FieldError errors={[errors.password]} />
        </Field>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}
