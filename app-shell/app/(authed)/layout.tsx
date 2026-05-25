import { Sidebar } from '@/components/Sidebar';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 px-8 py-10 max-w-5xl">{children}</main>
    </div>
  );
}
