import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Personal agent — OrcaTrade Group',
  description:
    'Your own AI agent reasoning over your saved plans, portfolios, and actuals. Calculator-grounded answers, citations on every regulatory claim, human-approved before any irreversible action.',
};

export default function AgentPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Personal agent',
        title: <>Your own AI, reasoning over your own data.</>,
        lead: "The orchestrator merges the four specialist agents' tools and — when you're signed in — adds tools that reason over your saved plans, your portfolios, your actuals, your compliance deadlines. Every monetary number it surfaces comes from a calculator output, every regulatory claim ends in a citation, every irreversible action routes through requestHumanReview first. The platform never files.",
        meta: 'Calculator-grounded · cites every claim · human-approved before any filing',
        ctas: [
          { label: 'Open the agent', href: '/app/agent' },
          { label: 'Read the model cards', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/ai/model-cards/README.md', variant: 'ghost' },
        ],
      }}
      steps={{
        label: 'Five agents + an orchestrator',
        items: [
          { title: 'Compliance', body: 'CBAM, EUDR, REACH, CE marking, AD/CVD. Per-shipment applicability + exposure + evidence gaps + citations.' },
          { title: 'Sourcing', body: 'Country comparisons, supplier vetting, factory-score interpretation, concentration-risk diagnostics.' },
          { title: 'Logistics', body: 'Mode + lane + warehouse + insurance with the deterministic landed-cost quote.' },
          { title: 'Finance', body: 'FX exposure, working-capital cycle, total cost of ownership, payment-instrument selection.' },
          { title: 'Orchestrator', body: 'Meta-agent: merges the four specialists\' tools into one surface, adds your personal context when signed in.' },
        ],
      }}
      scenarios={{
        label: 'The discipline that holds',
        items: [
          { badge: 'No LLM-made numbers', title: 'Every figure cites a tool', body: 'checkGrounding catches fabrication (a number in the prose that is not in calc output). checkNumericFidelity catches omission (a calc output the LLM failed to surface). Both run on every shipped case.', variant: 'positive' },
          { badge: 'Citations enforced', title: '[chunk-id] on every regulatory claim', body: 'The retrieval corpus is the source of truth; the agent cites the chunk it relied on. A claim without a citation is a model failure and fails its eval case.', variant: 'positive' },
          { badge: 'Human-in-the-loop', title: 'requestHumanReview before any irreversible action', body: 'Customs filings, CBAM surrenders, EUDR DDS submissions, supplier contracts above threshold — none execute without your explicit click. The platform itself never files.', variant: 'positive' },
        ],
      }}
      closer={{
        label: 'Start using your agent',
        title: 'Free tier includes twenty agent queries a month — enough to evaluate.',
        ctas: [
          { label: 'Sign in', href: '/signin' },
          { label: 'See pricing', href: '/pricing', variant: 'ghost' },
        ],
      }}
    />
  );
}
