import type { Metadata } from 'next';
import { PlatformPage } from '@/components/marketing/platform-page';

export const metadata: Metadata = {
  title: 'OrcaTrade Platform — Asia → Europe import operating system',
  description:
    'Five stages, one journey. Find it, prove it, move it, pay for it, run it. Calculator-grounded across the whole import lifecycle.',
};

export default function Platform() {
  return <PlatformPage />;
}
