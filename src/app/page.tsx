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
            可跑通闭环 · 对话 / 画像 / 记忆 / 知识库 / 会诊（演示）
          </div>
          <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            医疗 AI 智能助手演示平台
          </h1>
          <p className="mt-4 text-balance text-base text-slate-600 sm:text-lg">
            面向患者、医生助理、医生三种角色的端到端演示：从对话追问到记忆沉淀，再到会诊接入与医生侧可见。
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
            <h2 className="mt-5 text-xl font-semibold text-slate-900">我是患者</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              微信风格会话列表与聊天界面，体验 AI 问诊追问与支付入口（演示）。
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-blue-50 px-2 py-1">对话</span>
              <span className="rounded-full bg-blue-50 px-2 py-1">追问采集</span>
              <span className="rounded-full bg-blue-50 px-2 py-1">会诊触发</span>
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
            <h2 className="mt-5 text-xl font-semibold text-slate-900">我是医生助理</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              管理患者档案、导入病历、维护知识库，查看关键词记忆与建议回复。
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-emerald-50 px-2 py-1">患者画像</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1">记忆检索</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1">知识库</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1">AI建议</span>
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
            <h2 className="mt-5 text-xl font-semibold text-slate-900">我是医生</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              仅展示已支付会诊患者，可直接发消息并结束会话，便于演示闭环。
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-teal-50 px-2 py-1">已支付可见</span>
              <span className="rounded-full bg-teal-50 px-2 py-1">AI建议</span>
              <span className="rounded-full bg-teal-50 px-2 py-1">记忆</span>
              <span className="rounded-full bg-teal-50 px-2 py-1">患者画像</span>
            </div>
          </Link>
        </div>

        <div className="mx-auto mt-10 w-full max-w-3xl">
          <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center text-xs text-slate-600 shadow-sm backdrop-blur">
            <Info size={14} className="text-slate-500" />
            <span>本地演示 · 页面入口仅用于体验与联调</span>
          </div>
        </div>
      </div>
    </div>
  );
}
