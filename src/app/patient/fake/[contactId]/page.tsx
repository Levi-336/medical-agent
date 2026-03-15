import Link from 'next/link';

export const dynamic = 'force-dynamic';

type ContactId = 'filehelper' | 'wechatpay' | 'official';

const CONTACTS: Record<
  ContactId,
  { title: string; messages: Array<{ side: 'left' | 'right'; text: string }>; avatarText: string; avatarBg: string }
> = {
  filehelper: {
    title: 'File Transfer Assistant',
    avatarText: 'F',
    avatarBg: '#2e62d9',
    messages: [
      { side: 'left', text: 'Welcome to File Transfer Assistant.' },
      { side: 'left', text: 'You can send files, images, and text to your desktop here.' },
      { side: 'right', text: 'Got it' },
    ],
  },
  wechatpay: {
    title: 'WeChat Pay',
    avatarText: 'P',
    avatarBg: '#fa9d3b',
    messages: [
      { side: 'left', text: 'WeChat Pay receipt' },
      { side: 'left', text: 'Payment successful: $12.50' },
      { side: 'right', text: 'Okay' },
    ],
  },
  official: {
    title: 'Official Account Updates',
    avatarText: 'O',
    avatarBg: '#2e62d9',
    messages: [
      { side: 'left', text: 'Today’s headline: AI healthcare applications are accelerating.' },
      { side: 'left', text: 'Health tip: consistent sleep and moderate exercise can support immunity.' },
      { side: 'right', text: 'Understood' },
    ],
  },
};

interface PageProps {
  params: Promise<{ contactId: string }>;
}

function iconThinStyle() {
  return { fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 24" } as const;
}

export default async function FakeChatPage({ params }: PageProps) {
  const { contactId } = await params;
  const id = (contactId as ContactId) in CONTACTS ? (contactId as ContactId) : 'filehelper';
  const contact = CONTACTS[id];

  return (
    <div className="relative mx-auto flex h-screen max-h-screen w-full max-w-md flex-col overflow-hidden bg-[#0f1419] shadow-2xl whatsapp-theme">
      <div className="h-[44px] w-full bg-[#202c33] sticky top-0 z-20 shrink-0 flex items-center justify-center">
        <div className="w-[134px] h-[20px] bg-black rounded-full"></div>
      </div>

      <header className="z-20 flex h-16 w-full items-center justify-between bg-[#202c33] px-4 border-b border-[#313d44]">
        <div className="flex items-center w-[50px]">
          <Link href="/patient" className="flex items-center text-[#8696a0] hover:text-white transition-colors p-1" aria-label="Back">
            <span className="material-symbols-outlined !text-[24px] leading-none" style={iconThinStyle()}>
              arrow_back
            </span>
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center gap-3">
          <div
            className="h-9 w-9 shrink-0 overflow-hidden rounded-full flex items-center justify-center text-[16px] font-semibold text-white"
            style={{ backgroundColor: contact.avatarBg }}
          >
            {contact.avatarText}
          </div>
          <div className="text-center">
            <h1 className="text-[16px] font-medium text-[#e9edef]">{contact.title}</h1>
            <p className="text-[12px] text-[#8696a0]">Demo chat</p>
          </div>
        </div>
        <div className="flex items-center justify-end w-[50px]">
          <button type="button" className="flex items-center justify-center text-[#8696a0] hover:text-white transition-colors p-1" aria-label="More">
            <span className="material-symbols-outlined !text-[24px] leading-none" style={iconThinStyle()}>
              more_vert
            </span>
          </button>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0f1419] no-scrollbar"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3e%3cdefs%3e%3cpattern id='a' patternUnits='userSpaceOnUse' width='20' height='20' patternTransform='scale(0.5) rotate(0)'%3e%3crect x='0' y='0' width='100%25' height='100%25' fill='hsla(0, 0%25, 100%25, 0)'/%3e%3cpath d='M 10,-2.55e-7 V 20 Z M -1.1677362e-8,10 H 20 Z' stroke-width='0.2' stroke='hsla(0, 0%25, 100%25, 0.01)' fill='none'/%3e%3c/pattern%3e%3c/defs%3e%3crect width='100%25' height='100%25' fill='url(%23a)'/%3e%3c/svg%3e")`,
        }}
      >
        {contact.messages.map((m, idx) =>
          m.side === 'left' ? (
            <div key={idx} className="flex items-start gap-3">
              <div
                className="h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm flex items-center justify-center text-[16px] font-semibold text-white"
                style={{ backgroundColor: contact.avatarBg }}
              >
                {contact.avatarText}
              </div>
              <div className="flex max-w-[75%] flex-col gap-1">
                <div className="relative rounded-2xl px-3 py-2.5 text-[15px] leading-relaxed shadow-sm bg-[#202c33] text-[#e9edef] rounded-bl-md">
                  <div className="whitespace-pre-wrap">{m.text}</div>
                </div>
                <span className="text-xs text-[#8696a0] ml-2">Just now</span>
              </div>
            </div>
          ) : (
            <div key={idx} className="flex items-start justify-end gap-3">
              <div className="flex max-w-[75%] flex-col gap-1 items-end">
                <div className="relative rounded-2xl px-3 py-2.5 text-[15px] leading-relaxed shadow-sm bg-[#005c4b] text-[#e9edef] rounded-br-md">
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  <div className="flex items-center justify-end mt-1">
                    <span className="text-xs text-[#8ce8c7] mr-1">Just now</span>
                    <span className="material-symbols-outlined !text-[14px] text-[#53bdeb]">done_all</span>
                  </div>
                </div>
              </div>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm bg-[#00d95f] flex items-center justify-center text-[16px] font-semibold text-white">
                Me
              </div>
            </div>
          )
        )}
        <div className="h-4" />
      </main>

      <footer
        className="z-20 w-full bg-[#202c33] px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 20px) + 1rem)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center justify-center w-11 h-11 rounded-full bg-[#2a3942] text-[#8696a0] transition-all shrink-0"
            aria-label="Voice"
            disabled
          >
            <span className="material-symbols-outlined !text-[20px] opacity-60">mic</span>
          </button>
          <div className="flex flex-1 items-center rounded-full bg-[#2a3942] px-4 py-2.5 min-h-[44px]">
            <input
              placeholder="Message"
              className="w-full bg-transparent p-0 text-[16px] text-[#e9edef] placeholder-[#8696a0] focus:outline-none border-none h-5 leading-5"
              disabled
            />
            <button
              type="button"
              className="ml-2 p-1 text-[#8696a0] transition-colors opacity-60"
              aria-label="Emoji"
              disabled
            >
              <span className="material-symbols-outlined !text-[20px]">sentiment_satisfied</span>
            </button>
            <button
              type="button"
              className="ml-1 p-1 text-[#8696a0] transition-colors opacity-60"
              aria-label="Attachment"
              disabled
            >
              <span className="material-symbols-outlined !text-[20px]">attach_file</span>
            </button>
          </div>
          <button
            type="button"
            className="h-11 w-11 shrink-0 rounded-full bg-[#8696a0] text-white flex items-center justify-center opacity-60 transition-all shadow-sm"
            aria-label="Send"
            disabled
          >
            <span className="material-symbols-outlined !text-[20px]">send</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
