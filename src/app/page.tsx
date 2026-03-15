import Link from 'next/link';
import { ArrowRight, ClipboardList, Info, Stethoscope, User } from 'lucide-react';

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-blue-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.06)_1px,transparent_0)] [background-size:22px_22px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-4 py-16 sm:px-8">
        <div className="mx-auto w-full max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs text-slate-600 shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            End-to-end demo flow: chat, persona, memory, knowledge base, and consultation
          </div>
          <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Medical AI Assistant Demo Platform
          </h1>
          <p className="mt-4 text-balance text-base text-slate-600 sm:text-lg">
            An end-to-end demo for patients, assistants, and doctors, covering guided intake,
            memory extraction, consultation handoff, and doctor-side visibility.
          </p>
        </div>

        <div className="mt-10 grid w-full grid-cols-1 gap-5 md:mt-12 md:grid-cols-3">
          <Link
            href="/patient"
            className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-sky-500 to-blue-500" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <User className="h-6 w-6" />
              </div>
              <ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-slate-900">I am a Patient</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              A WhatsApp-style dark interface with voice input and guided intake for patient-side
              conversations.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-blue-50 px-2 py-1">WhatsApp-style UI</span>
              <span className="rounded-full bg-blue-50 px-2 py-1">Voice input</span>
              <span className="rounded-full bg-blue-50 px-2 py-1">Smart follow-up</span>
              <span className="rounded-full bg-blue-50 px-2 py-1">Consultation payment</span>
            </div>
          </Link>

          <Link
            href="/assistant"
            className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-500" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <ClipboardList className="h-6 w-6" />
              </div>
              <ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-slate-900">I am an Assistant</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Manage patient records, import medical notes, maintain the knowledge base, and review
              memory signals with AI suggestions.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-emerald-50 px-2 py-1">Patient persona</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1">Memory retrieval</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1">Knowledge base</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1">AI suggestions</span>
            </div>
          </Link>

          <Link
            href="/doctor"
            className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-6 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-500 via-emerald-500 to-teal-500" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
                <Stethoscope className="h-6 w-6" />
              </div>
              <ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-slate-900">I am a Doctor</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              View paid consultations only, reply directly to patients, and close the consultation
              when the demo flow is complete.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-teal-50 px-2 py-1">Visible after payment</span>
              <span className="rounded-full bg-teal-50 px-2 py-1">AI suggestions</span>
              <span className="rounded-full bg-teal-50 px-2 py-1">Memory</span>
              <span className="rounded-full bg-teal-50 px-2 py-1">Patient persona</span>
            </div>
          </Link>
        </div>

        <div className="mx-auto mt-10 w-full max-w-3xl">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center text-xs text-slate-600 shadow-sm backdrop-blur">
            <Info size={14} className="text-slate-500" />
            <span>Local demo entry points for experience testing and integration checks</span>
          </div>
        </div>
      </div>
    </div>
  );
}
