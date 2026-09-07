import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Activity, Cpu, ArrowLeft } from 'lucide-react';
import { db, doc, getDocSmart } from '../dbClient';

interface WelcomeLoaderProps {
  clinicName?: string;
  doctorName?: string;
  logoUrl?: string;
  staffRole?: string;
  onComplete: () => void;
  durationMs?: number;
}

export default function WelcomeLoader({
  clinicName = 'عيادتك الرقمية',
  doctorName,
  logoUrl,
  staffRole,
  onComplete,
  durationMs = 3000
}: WelcomeLoaderProps) {
  const [progress, setProgress] = useState(0);
  const [displayLogo, setDisplayLogo] = useState<string>(logoUrl || '');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch default system logo if clinic logo is not provided
  useEffect(() => {
    if (logoUrl) {
      setDisplayLogo(logoUrl);
      return;
    }

    let isMounted = true;
    async function fetchDefaultLogo() {
      try {
        const supportDocRef = doc(db, 'system_settings', 'support');
        const snap = await getDocSmart(supportDocRef);
        if (snap && snap.exists() && snap.data()?.defaultSystemLogoUrl) {
          if (isMounted) {
            setDisplayLogo(snap.data().defaultSystemLogoUrl);
          }
        }
      } catch (err) {
        console.warn('Error loading default loader logo:', err);
      }
    }

    fetchDefaultLogo();
    return () => { isMounted = false; };
  }, [logoUrl]);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Smooth 5-second progress ticker
  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const currentProgress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setProgress(currentProgress);

      if (elapsed >= durationMs) {
        clearInterval(interval);
        setTimeout(() => {
          onCompleteRef.current();
        }, 150);
      }
    }, 25);

    return () => clearInterval(interval);
  }, [durationMs]);

  // High-Tech Sky Blue Molar Canvas Engine (أبيض ولبني)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Floating Particles
    const particles = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vy: -(0.4 + Math.random() * 0.8),
      size: 1.5 + Math.random() * 2,
      alpha: 0.2 + Math.random() * 0.5,
      char: Math.random() > 0.5 ? '1' : '0'
    }));

    // Light Sky Blue Palette for Rays
    const rayColors = ['#0284c7', '#06b6d4', '#38bdf8', '#0284c7', '#0369a1'];

    let time = 0;

    function render() {
      ctx!.clearRect(0, 0, width, height);
      time += 0.016;

      const cx = width / 2;
      const cy = height / 2;
      const S = Math.min(width, height) * (width < 640 ? 0.38 : 0.44);

      const rx = (x: number) => cx + x * S;
      const ry = (y: number) => cy + y * S;

      // 1. RADIATING CIRCUIT RAYS
      const numRays = 32;
      for (let i = 0; i < numRays; i++) {
        const baseAngle = (i / numRays) * Math.PI * 2;
        const color = rayColors[i % rayColors.length];

        const startR = S * (0.65 + (i % 3) * 0.08);
        const x0 = cx + Math.cos(baseAngle) * startR;
        const y0 = cy + Math.sin(baseAngle) * startR;

        const midR = startR + Math.min(width, height) * (0.12 + (i % 4) * 0.05);
        const snapAngle = baseAngle + (i % 2 === 0 ? Math.PI / 8 : -Math.PI / 8);
        const x1 = cx + Math.cos(snapAngle) * midR;
        const y1 = cy + Math.sin(snapAngle) * midR;

        const endR = Math.max(width, height) * 0.75;
        const finalAngle = snapAngle + (i % 3 === 0 ? 0 : (i % 2 === 0 ? 0.15 : -0.15));
        const x2 = cx + Math.cos(finalAngle) * endR;
        const y2 = cy + Math.sin(finalAngle) * endR;

        ctx!.beginPath();
        ctx!.moveTo(x0, y0);
        ctx!.lineTo(x1, y1);
        ctx!.lineTo(x2, y2);
        ctx!.strokeStyle = color;
        ctx!.lineWidth = (i % 4 === 0) ? 1.8 : 1.0;
        ctx!.globalAlpha = (i % 2 === 0) ? 0.25 : 0.12;
        ctx!.stroke();

        ctx!.fillStyle = color;
        ctx!.globalAlpha = 0.4;
        ctx!.beginPath();
        ctx!.arc(x1, y1, (i % 4 === 0) ? 2.5 : 1.5, 0, Math.PI * 2);
        ctx!.fill();

        // Traveling Pulses
        const speed = 0.002 + (i % 5) * 0.001;
        const progress = (time * speed * 60 + i * 0.1) % 1;

        const d1 = Math.hypot(x1 - x0, y1 - y0);
        const d2 = Math.hypot(x2 - x1, y2 - y1);
        const totalD = d1 + d2;
        const currentD = progress * totalD;

        let px = x0;
        let py = y0;

        if (currentD <= d1) {
          const ratio = currentD / d1;
          px = x0 + (x1 - x0) * ratio;
          py = y0 + (y1 - y0) * ratio;
        } else {
          const ratio = (currentD - d1) / d2;
          px = x1 + (x2 - x1) * ratio;
          py = y1 + (y2 - y1) * ratio;
        }

        ctx!.shadowBlur = 8;
        ctx!.shadowColor = color;
        ctx!.fillStyle = '#0284c7';
        ctx!.globalAlpha = 0.9;
        ctx!.beginPath();
        ctx!.arc(px, py, (i % 4 === 0) ? 3 : 2, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.shadowBlur = 0;
      }

      // 2. MOLAR TOOTH SHELL
      const drawMolarShell = (scaleFactor: number, strokeColor: string, lineWidth: number, alpha: number) => {
        ctx!.save();
        ctx!.translate(cx, cy);
        ctx!.scale(scaleFactor, scaleFactor);
        ctx!.translate(-cx, -cy);

        ctx!.beginPath();
        ctx!.moveTo(rx(0), ry(-0.48));
        ctx!.bezierCurveTo(rx(0.12), ry(-0.52), rx(0.24), ry(-0.62), rx(0.36), ry(-0.58));
        ctx!.bezierCurveTo(rx(0.52), ry(-0.50), rx(0.58), ry(-0.30), rx(0.50), ry(-0.08));
        ctx!.bezierCurveTo(rx(0.44), ry(0.15), rx(0.38), ry(0.45), rx(0.26), ry(0.82));
        ctx!.bezierCurveTo(rx(0.22), ry(0.88), rx(0.12), ry(0.86), rx(0.10), ry(0.72));
        ctx!.bezierCurveTo(rx(0.08), ry(0.45), rx(0.05), ry(0.22), rx(0), ry(0.12));
        ctx!.bezierCurveTo(rx(-0.05), ry(0.22), rx(-0.08), ry(0.45), rx(-0.10), ry(0.72));
        ctx!.bezierCurveTo(rx(-0.12), ry(0.86), rx(-0.22), ry(0.88), rx(-0.26), ry(0.82));
        ctx!.bezierCurveTo(rx(-0.38), ry(0.45), rx(-0.44), ry(0.15), rx(-0.50), ry(-0.08));
        ctx!.bezierCurveTo(rx(-0.58), ry(-0.30), rx(-0.52), ry(-0.50), rx(-0.36), ry(-0.58));
        ctx!.bezierCurveTo(rx(-0.24), ry(-0.62), rx(-0.12), ry(-0.52), rx(0), ry(-0.48));
        ctx!.closePath();

        ctx!.strokeStyle = strokeColor;
        ctx!.lineWidth = lineWidth;
        ctx!.globalAlpha = alpha;
        ctx!.shadowBlur = alpha > 0.5 ? 12 : 0;
        ctx!.shadowColor = strokeColor;
        ctx!.stroke();

        ctx!.restore();
      };

      drawMolarShell(1.0, '#0284c7', 2.8, 0.85);
      drawMolarShell(0.84, '#06b6d4', 1.8, 0.6);
      drawMolarShell(0.68, '#38bdf8', 1.2, 0.4);

      // Helper function to calculate exact coordinates along the molar contour
      const getMolarContourPoint = (progress: number) => {
        const segments = [
          { p0: [0, -0.48], p1: [0.12, -0.52], p2: [0.24, -0.62], p3: [0.36, -0.58] },
          { p0: [0.36, -0.58], p1: [0.52, -0.50], p2: [0.58, -0.30], p3: [0.50, -0.08] },
          { p0: [0.50, -0.08], p1: [0.44, 0.15], p2: [0.38, 0.45], p3: [0.26, 0.82] },
          { p0: [0.26, 0.82], p1: [0.22, 0.88], p2: [0.12, 0.86], p3: [0.10, 0.72] },
          { p0: [0.10, 0.72], p1: [0.08, 0.45], p2: [0.05, 0.22], p3: [0, 0.12] },
          { p0: [0, 0.12], p1: [-0.05, 0.22], p2: [-0.08, 0.45], p3: [-0.10, 0.72] },
          { p0: [-0.10, 0.72], p1: [-0.12, 0.86], p2: [-0.22, 0.88], p3: [-0.26, 0.82] },
          { p0: [-0.26, 0.82], p1: [-0.38, 0.45], p2: [-0.44, 0.15], p3: [-0.50, -0.08] },
          { p0: [-0.50, -0.08], p1: [-0.58, -0.30], p2: [-0.52, -0.50], p3: [-0.36, -0.58] },
          { p0: [-0.36, -0.58], p1: [-0.24, -0.62], p2: [-0.12, -0.52], p3: [0, -0.48] },
        ];

        const pNorm = ((progress % 1) + 1) % 1;
        const scaled = pNorm * segments.length;
        const idx = Math.min(Math.floor(scaled), segments.length - 1);
        const t = scaled - idx;

        const seg = segments[idx];
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;

        const nx = uuu * seg.p0[0] + 3 * uu * t * seg.p1[0] + 3 * u * tt * seg.p2[0] + ttt * seg.p3[0];
        const ny = uuu * seg.p0[1] + 3 * uu * t * seg.p1[1] + 3 * u * tt * seg.p2[1] + ttt * seg.p3[1];

        return { x: rx(nx), y: ry(ny) };
      };

      // Draw Glowing Animated Dots moving along the Molar Edges / Outer & Inner Shells
      const drawGlowingEdgePulses = () => {
        const shellConfigs = [
          { scale: 1.0, count: 8, speed: 0.08, color: '#0284c7', glow: '#38bdf8' },
          { scale: 0.84, count: 6, speed: -0.06, color: '#06b6d4', glow: '#22d3ee' },
          { scale: 0.68, count: 4, speed: 0.05, color: '#0284c7', glow: '#60a5fa' },
        ];

        shellConfigs.forEach((config) => {
          for (let i = 0; i < config.count; i++) {
            const baseOffset = i / config.count;
            const dotProgress = (time * config.speed + baseOffset) % 1;

            // Draw trailing comet tail (5 fading particles behind main glowing dot)
            const tailLength = 5;
            for (let tStep = tailLength; tStep >= 0; tStep--) {
              const lag = tStep * 0.007;
              const trailProgress = (dotProgress - (config.speed > 0 ? lag : -lag) + 1) % 1;
              const rawPt = getMolarContourPoint(trailProgress);

              // Apply shell scale transformation from center (cx, cy)
              const px = cx + (rawPt.x - cx) * config.scale;
              const py = cy + (rawPt.y - cy) * config.scale;

              const isHead = tStep === 0;
              const alpha = isHead ? 0.95 : 0.7 - tStep * 0.12;
              const dotSize = isHead ? 4.5 : Math.max(1.2, 3.8 - tStep * 0.6);

              ctx!.save();
              ctx!.beginPath();
              ctx!.arc(px, py, dotSize, 0, Math.PI * 2);

              if (isHead) {
                ctx!.shadowBlur = 18;
                ctx!.shadowColor = config.glow;
                ctx!.fillStyle = '#ffffff';
                ctx!.globalAlpha = 1.0;
                ctx!.fill();

                // Outer aura ring for head
                ctx!.beginPath();
                ctx!.arc(px, py, dotSize + 2, 0, Math.PI * 2);
                ctx!.fillStyle = config.glow;
                ctx!.globalAlpha = 0.5;
                ctx!.fill();
              } else {
                ctx!.shadowBlur = 8;
                ctx!.shadowColor = config.color;
                ctx!.fillStyle = config.glow;
                ctx!.globalAlpha = Math.max(0, alpha);
                ctx!.fill();
              }

              ctx!.restore();
            }
          }
        });
      };

      drawGlowingEdgePulses();

      // 3. ROOT CANAL PULP CHAMBER
      const drawPulpCanals = () => {
        ctx!.beginPath();
        ctx!.moveTo(rx(-0.15), ry(-0.25));
        ctx!.bezierCurveTo(rx(-0.20), ry(-0.15), rx(-0.18), ry(0.0), rx(-0.12), ry(0.08));
        ctx!.bezierCurveTo(rx(-0.15), ry(0.30), rx(-0.18), ry(0.55), rx(-0.18), ry(0.78));

        ctx!.moveTo(rx(0.15), ry(-0.25));
        ctx!.bezierCurveTo(rx(0.20), ry(-0.15), rx(0.18), ry(0.0), rx(0.12), ry(0.08));
        ctx!.bezierCurveTo(rx(0.15), ry(0.30), rx(0.18), ry(0.55), rx(0.18), ry(0.78));

        ctx!.moveTo(rx(-0.15), ry(-0.25));
        ctx!.bezierCurveTo(rx(-0.08), ry(-0.32), rx(0.08), ry(-0.32), rx(0.15), ry(-0.25));

        ctx!.strokeStyle = '#0284c7';
        ctx!.lineWidth = 2.2;
        ctx!.globalAlpha = 0.85;
        ctx!.shadowBlur = 10;
        ctx!.shadowColor = '#38bdf8';
        ctx!.stroke();
        ctx!.shadowBlur = 0;
      };

      drawPulpCanals();

      // 4. TRANSVERSE GRID RUNGS
      const drawGridRungs = () => {
        const rungLevels = [-0.45, -0.32, -0.18, -0.02, 0.15, 0.32, 0.50, 0.68];
        rungLevels.forEach((levelY) => {
          const w = S * (levelY < 0 ? 0.45 : levelY < 0.2 ? 0.38 : 0.28);
          ctx!.beginPath();
          ctx!.ellipse(cx, ry(levelY), w, w * 0.25, 0, 0, Math.PI * 2);
          ctx!.strokeStyle = '#0284c7';
          ctx!.lineWidth = 1;
          ctx!.globalAlpha = 0.2 + 0.1 * Math.sin(time * 2 + levelY * 5);
          ctx!.stroke();
        });
      };

      drawGridRungs();

      // 5. SCANNING LASER BEAM
      const scanY = ry(-0.6 + Math.sin(time * 1.8) * 0.7);
      const scanGrad = ctx!.createLinearGradient(cx - S * 0.6, scanY, cx + S * 0.6, scanY);
      scanGrad.addColorStop(0, 'rgba(2, 132, 199, 0)');
      scanGrad.addColorStop(0.3, 'rgba(2, 132, 199, 0.8)');
      scanGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.95)');
      scanGrad.addColorStop(0.7, 'rgba(6, 182, 212, 0.8)');
      scanGrad.addColorStop(1, 'rgba(6, 182, 212, 0)');

      ctx!.beginPath();
      ctx!.moveTo(cx - S * 0.6, scanY);
      ctx!.lineTo(cx + S * 0.6, scanY);
      ctx!.strokeStyle = scanGrad;
      ctx!.lineWidth = 2.5;
      ctx!.shadowBlur = 10;
      ctx!.shadowColor = '#38bdf8';
      ctx!.globalAlpha = 0.85;
      ctx!.stroke();
      ctx!.shadowBlur = 0;

      // 6. PARTICLES
      particles.forEach((pt) => {
        pt.y += pt.vy;
        if (pt.y < 0) {
          pt.y = height;
          pt.x = Math.random() * width;
        }

        ctx!.font = '10px monospace';
        ctx!.fillStyle = '#0284c7';
        ctx!.globalAlpha = pt.alpha * (0.6 + 0.4 * Math.sin(time * 3 + pt.x));
        ctx!.fillText(pt.char, pt.x, pt.y);
      });

      ctx!.globalAlpha = 1.0;
      animationFrameId = requestAnimationFrame(render);
    }

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const getStatusMessage = () => {
    if (progress < 25) return 'تأسيس الاتصال السحابي المشفر...';
    if (progress < 60) return 'تحديث سجلات العيادة والمحركات الذكية...';
    if (progress < 90) return 'تهيئة معايير الأمان وجدول المواعيد...';
    return 'مرحباً بك! جاري الفتح...';
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-100 bg-gradient-to-br from-slate-100 via-sky-50 to-blue-100 text-slate-800 font-sans overflow-hidden select-none"
        dir="rtl"
      >
        {/* Light Atmosphere Soft Radial Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-sky-200/40 via-cyan-100/30 to-blue-200/30 pointer-events-none" />

        {/* Dynamic Canvas Engine */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-95"
        />

        {/* Pulsing Backlight Aura */}
        <motion.div
          animate={{
            scale: [0.85, 1.2, 0.85],
            opacity: [0.4, 0.7, 0.4],
          }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] sm:w-[480px] sm:h-[480px] bg-gradient-to-r from-sky-300/40 via-cyan-200/50 to-blue-300/40 rounded-full blur-[100px] pointer-events-none z-0"
        />

        {/* Top Header Section (أعلى الشاشة تماماً بعيداً عن رسمة الدرس) */}
        <div className="relative z-10 w-full max-w-lg mx-auto px-4 pt-6 sm:pt-10 flex flex-col items-center text-center space-y-3">
          {/* Light System Badge Tag */}
          <motion.div
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-white/90 border border-sky-200/90 text-sky-800 text-xs font-black tracking-wide shadow-md shadow-sky-100/80 backdrop-blur-md"
          >
            <Cpu className="h-4 w-4 text-sky-600 animate-spin" />
            <span>نظام CoreDentSys الذكي • CoreDentSys</span>
          </motion.div>

          {/* Doctor & Clinic Greeting Typography (فوق الشاشة أعلى رسمة الدرس) */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="space-y-1"
          >
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center justify-center gap-2">
              <span>{doctorName ? `أهلاً بك دكتور ${doctorName}` : `أهلاً بك في`}</span>
              <Sparkles className="h-5 w-5 text-sky-500 shrink-0 animate-pulse" />
            </h1>

            {staffRole && (
              <span className="inline-block text-xs font-extrabold text-sky-800 bg-sky-100/90 px-3.5 py-1 rounded-full border border-sky-200 mt-1 shadow-2xs">
                صلاحية الدخول: {staffRole}
              </span>
            )}
          </motion.div>
        </div>

        {/* Center Content Section (منتصف الشاشة - شكل الدرس واللوجو) */}
        <div className="relative z-10 flex flex-col items-center text-center px-4 max-w-lg mx-auto w-full my-auto">
          {/* Center Logo Frame (شكل الدرس واللوجو) */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex items-center justify-center group"
          >
            {/* Spinning Light Ring 1 */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              className="absolute -inset-5 sm:-inset-7 rounded-full border border-dashed border-sky-300/60 pointer-events-none"
            />

            {/* Spinning Light Ring 2 */}
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ repeat: Infinity, duration: 30, ease: "linear" }}
              className="absolute -inset-9 sm:-inset-12 rounded-full border border-dotted border-cyan-300/50 pointer-events-none"
            />

            {/* Glassmorphic Logo Card */}
            <div className="relative p-1 rounded-3xl bg-white/90 shadow-xl shadow-sky-900/10 border border-sky-200/80 backdrop-blur-xl">
              <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-[22px] bg-slate-50/90 border border-sky-100 flex items-center justify-center p-3 sm:p-4 overflow-hidden relative shadow-inner">
                {displayLogo && displayLogo.trim() !== '' ? (
                  <div className="w-full h-full bg-white rounded-xl p-2 sm:p-2.5 flex items-center justify-center shadow-sm border border-sky-100">
                    <img
                      src={displayLogo}
                      alt={clinicName}
                      className="max-w-full max-h-full object-contain filter drop-shadow-sm transition duration-300"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-sky-600 space-y-1.5">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-sky-100/80 flex items-center justify-center border border-sky-200 shadow-xs">
                      <Activity className="h-7 w-7 sm:h-8 sm:w-8 text-sky-600 animate-pulse" />
                    </div>
                    <span className="text-[11px] sm:text-xs font-black tracking-wider text-slate-700">CoreDentSys</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Section: Progress Bar & Direct Access (أسفل الصفحة تماماً) */}
        <div className="relative z-10 w-full max-w-xs sm:max-w-md mx-auto px-4 pb-6 sm:pb-8 flex flex-col items-center space-y-3">
          {/* Light Progress Power Bar */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="w-full space-y-2.5"
          >
            <div className="flex items-center justify-between text-xs font-black px-1">
              <span className="text-sky-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping inline-block" />
                <span>{getStatusMessage()}</span>
              </span>
              <span className="font-mono text-sky-700 text-sm font-extrabold">{progress}%</span>
            </div>

            {/* Light Track Bar */}
            <div className="relative w-full h-3 bg-white/90 rounded-full border border-sky-200/90 overflow-hidden p-0.5 shadow-sm">
              <motion.div
                className="h-full bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 rounded-full shadow-sm relative"
                style={{ width: `${progress}%` }}
                transition={{ ease: "linear" }}
              >
                {/* Tip Light Beam */}
                <div className="absolute top-0 right-0 bottom-0 w-3 bg-white/90 rounded-full blur-[0.5px]" />
              </motion.div>
            </div>
          </motion.div>

          {/* Direct Access Action */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-col items-center"
          >
            <button
              type="button"
              onClick={onComplete}
              className="text-xs font-extrabold text-slate-500 hover:text-sky-700 transition flex items-center gap-1.5 cursor-pointer py-1.5 px-4 rounded-xl hover:bg-white/80 active:scale-95 border border-transparent hover:border-sky-200"
            >
              <span>دخول مباشر للسيستم</span>
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
