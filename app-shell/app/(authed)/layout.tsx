import { Sidebar } from '@/components/Sidebar';

// Authenticated cockpit shell. Sidebar fixed-positioned at md+ width 280;
// at sm it is a drawer with hamburger trigger. Main content takes 280px
// left margin on desktop so it does not slide under the sidebar.
export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-ink)]">
      <Sidebar />
      <main className="min-h-screen px-6 pt-20 pb-16 md:ml-[280px] md:px-10 md:pt-12 md:pb-20">
        <div className="mx-auto max-w-[1080px]">{children}</div>
      </main>
    </div>
  );
}
