"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useActionState } from "react";
import { login } from "@/app/actions/auth";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    Awaited<ReturnType<typeof login>> | undefined,
    FormData
  >(login, undefined);
  const isLoading = isPending;

  useEffect(() => {
    if (state?.ok) {
      router.push(state.home ?? "/");
      router.refresh();
    }
  }, [state, router]);

  // Finance-themed animated background (very slow)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const lines: {
      y: number;
      speed: number;
      amplitude: number;
      frequency: number;
      phase: number;
      color: string;
      opacity: number;
    }[] = [];

    const floatingNumbers: {
      x: number;
      y: number;
      speed: number;
      value: string;
      opacity: number;
      size: number;
    }[] = [];

    const bars: {
      x: number;
      height: number;
      targetHeight: number;
      speed: number;
      width: number;
      opacity: number;
    }[] = [];

    const initAnimations = () => {
      const w = canvas.width;
      const h = canvas.height;

      lines.length = 0;
      const lineColors = [
        "99, 102, 241",
        "168, 85, 247",
        "236, 72, 153",
        "59, 130, 246",
        "139, 92, 246",
      ];
      for (let i = 0; i < 6; i++) {
        lines.push({
          y: h * (0.15 + i * 0.14),
          speed: 0.0004 + Math.random() * 0.0007,
          amplitude: 20 + Math.random() * 50,
          frequency: 0.003 + Math.random() * 0.004,
          phase: Math.random() * Math.PI * 2,
          color: lineColors[i % lineColors.length],
          opacity: 0.12 + Math.random() * 0.1,
        });
      }

      floatingNumbers.length = 0;
      const sampleValues = [
        "£1,240.50",
        "£8,920",
        "+12.4%",
        "£45,000",
        "AAA",
        "£3,750",
        "+8.2%",
        "£120K",
        "72 days",
        "£980",
        "A+",
        "+15.6%",
      ];
      for (let i = 0; i < 14; i++) {
        floatingNumbers.push({
          x: Math.random() * w,
          y: Math.random() * h,
          speed: 0.012 + Math.random() * 0.025,
          value: sampleValues[i % sampleValues.length],
          opacity: 0.06 + Math.random() * 0.08,
          size: 11 + Math.random() * 8,
        });
      }

      bars.length = 0;
      const barCount = 24;
      const barWidth = w / barCount;
      for (let i = 0; i < barCount; i++) {
        bars.push({
          x: i * barWidth,
          height: 0,
          targetHeight: 40 + Math.random() * 120,
          speed: 0.03 + Math.random() * 0.08,
          width: barWidth * 0.6,
          opacity: 0.04 + Math.random() * 0.06,
        });
      }
    };

    initAnimations();
    const handleResize = () => {
      resize();
      initAnimations();
    };
    window.addEventListener("resize", handleResize);

    const animate = () => {
      time += 1;

      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;

      const blobs = [
        { color: [99, 102, 241], x: 0.3, y: 0.3, r: 0.5, speed: 0.00003 },
        { color: [168, 85, 247], x: 0.7, y: 0.6, r: 0.55, speed: 0.00004 },
        { color: [236, 72, 153], x: 0.5, y: 0.8, r: 0.45, speed: 0.000035 },
      ];

      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        const t = time * b.speed;
        const cx = w * (b.x + 0.15 * Math.sin(t * 1.3 + i));
        const cy = h * (b.y + 0.15 * Math.cos(t * 1.1 + i * 2));
        const r = Math.max(w, h) * b.r;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const [red, green, blue] = b.color;
        grad.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0.15)`);
        grad.addColorStop(0.5, `rgba(${red}, ${green}, ${blue}, 0.06)`);
        grad.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.strokeStyle = "rgba(99, 102, 241, 0.05)";
      ctx.lineWidth = 1;
      const gridSize = 60;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      for (const bar of bars) {
        if (bar.height < bar.targetHeight) {
          bar.height += bar.speed;
          if (bar.height > bar.targetHeight) bar.height = bar.targetHeight;
        } else {
          bar.height = bar.targetHeight + Math.sin(time * 0.0015 + bar.x) * 8;
        }

        const barY = h - bar.height;
        const grad = ctx.createLinearGradient(0, h, 0, barY);
        grad.addColorStop(0, `rgba(99, 102, 241, ${bar.opacity * 2})`);
        grad.addColorStop(1, `rgba(168, 85, 247, ${bar.opacity})`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        const radius = Math.min(bar.width / 2, 4);
        const x = bar.x + gridSize * 0.2;
        const bw = Math.min(bar.width, gridSize * 0.6);
        ctx.moveTo(x, h);
        ctx.lineTo(x, barY + radius);
        ctx.quadraticCurveTo(x, barY, x + radius, barY);
        ctx.lineTo(x + bw - radius, barY);
        ctx.quadraticCurveTo(x + bw, barY, x + bw, barY + radius);
        ctx.lineTo(x + bw, h);
        ctx.closePath();
        ctx.fill();
      }

      for (const line of lines) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${line.color}, ${line.opacity})`;
        ctx.lineWidth = 1.5;

        for (let x = 0; x <= w; x += 4) {
          const y =
            line.y +
            Math.sin(x * line.frequency + time * line.speed * 10 + line.phase) *
              line.amplitude +
            Math.sin(x * line.frequency * 2.3 + time * line.speed * 7) *
              (line.amplitude * 0.4);

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        const endY =
          line.y +
          Math.sin(w * line.frequency + time * line.speed * 10 + line.phase) *
            line.amplitude +
          Math.sin(w * line.frequency * 2.3 + time * line.speed * 7) *
            (line.amplitude * 0.4);

        const dotGrad = ctx.createRadialGradient(w - 10, endY, 0, w - 10, endY, 12);
        dotGrad.addColorStop(0, `rgba(${line.color}, ${line.opacity * 3})`);
        dotGrad.addColorStop(1, `rgba(${line.color}, 0)`);
        ctx.fillStyle = dotGrad;
        ctx.beginPath();
        ctx.arc(w - 10, endY, 12, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.textAlign = "center";
      for (const num of floatingNumbers) {
        num.y -= num.speed;
        if (num.y < -30) {
          num.y = h + 30;
          num.x = Math.random() * w;
        }

        ctx.font = `500 ${num.size}px ui-monospace, monospace`;
        ctx.fillStyle = `rgba(139, 92, 246, ${num.opacity})`;
        ctx.fillText(num.value, num.x, num.y);
      }

      const shimmerX = ((time * 0.04) % (w + 600)) - 300;
      const shimmer = ctx.createLinearGradient(
        shimmerX - 250,
        0,
        shimmerX + 250,
        h
      );
      shimmer.addColorStop(0, "rgba(255, 255, 255, 0)");
      shimmer.addColorStop(0.5, "rgba(255, 255, 255, 0.015)");
      shimmer.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = shimmer;
      ctx.fillRect(0, 0, w, h);

      animationFrameId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-theme font-sans">
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-0 grain opacity-[0.05]" />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#0a0a0f_80%)]" />

      <main className="relative z-10 w-full max-w-md px-6 py-12">
        <div className="solid-card relative rounded-2xl border border-indigo-500/50 bg-[#1e1b4b] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.5)] sm:p-10">
          <div className="relative mb-8 flex flex-col items-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Credit Control Daily
            </h1>
            <p className="mt-3 text-sm text-zinc-500">
              Sign in to your account to continue
            </p>
          </div>

          <form action={formAction} className="relative flex flex-col gap-5">
            {state && !state.ok && state.error ? (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
              >
                {state.error}
              </div>
            ) : null}

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-zinc-300">
                Email
              </label>
              <div className="group/input relative">
                <div className="pointer-events-none absolute -inset-px rounded-lg bg-gradient-to-r from-indigo-500/50 to-purple-500/50 opacity-0 blur transition-opacity duration-300 group-focus-within/input:opacity-100" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="relative h-11 w-full rounded-lg border border-white/10 bg-white px-3.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none backdrop-blur-sm transition-all duration-300 focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-zinc-300">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="cursor-pointer text-sm font-medium text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  Forgot?
                </Link>
              </div>
              <div className="group/input relative">
                <div className="pointer-events-none absolute -inset-px rounded-lg bg-gradient-to-r from-indigo-500/50 to-purple-500/50 opacity-0 blur transition-opacity duration-300 group-focus-within/input:opacity-100" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="relative h-11 w-full rounded-lg border border-white/10 bg-white px-3.5 pr-11 text-sm text-zinc-900 placeholder-zinc-400 outline-none backdrop-blur-sm transition-all duration-300 focus:border-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-zinc-500 transition-colors hover:text-zinc-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Remember me toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Remember me</span>
              <input
                type="hidden"
                name="remember"
                value={rememberMe ? "on" : ""}
              />
              <button
                type="button"
                role="switch"
                aria-checked={rememberMe}
                aria-label="Remember me"
                onClick={() => setRememberMe(!rememberMe)}
                className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full border transition-colors duration-300 outline-none focus:outline-none focus-visible:outline-none ${
                  rememberMe
                    ? "border-indigo-500/50 bg-gradient-to-r from-indigo-600 to-purple-600"
                    : "border-white/10 bg-white/[0.06]"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-300 ${
                    rememberMe ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="group/btn relative mt-2 flex h-11 w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-medium text-white transition-all duration-300 hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover/btn:translate-x-full" />
              <span className="relative flex items-center gap-2">
                {isLoading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </span>
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-600">
          By signing in, you agree to our{" "}
          <Link href="/terms" className="cursor-pointer text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300 hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="cursor-pointer text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-300 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </main>

      <style jsx global>{`
        .grain {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }
      `}</style>
    </div>
  );
}