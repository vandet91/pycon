"use client";

import { Suspense } from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Cookies from "js-cookie";

function AuthCallback() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      Cookies.set("psm_token", token, { expires: 1, sameSite: "strict" });
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="text-white text-sm animate-pulse">Signing in…</div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white text-sm animate-pulse">Signing in…</div>
      </div>
    }>
      <AuthCallback />
    </Suspense>
  );
}
