import { Sidebar } from '@/components/Sidebar';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:px-12 md:py-16">
          {children}
        </div>
      </main>
    </div>
  );
}
