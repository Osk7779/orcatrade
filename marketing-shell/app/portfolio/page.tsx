import type { Metadata } from 'next';
import { DomainLanding } from '@/components/marketing/domain-landing';

export const metadata: Metadata = {
  title: 'Portfolio planning — OrcaTrade Group',
  description:
    'Multi-SKU portfolio planner. Per-line plans aggregated into a portfolio total with blended duty, lane consolidation savings, and the FX leg priced separately.',
};

export default function PortfolioPage() {
  return (
    <DomainLanding
      hero={{
        kicker: 'Portfolio planning',
        title: <>One plan per SKU is the wrong unit. The portfolio is.</>,
        lead: "Real importers run a basket — half a dozen to a hundred SKUs from two or three origins through one or two lanes. Pricing them individually misses the lane-consolidation saving, the blended duty rate that determines tier pricing, and the FX exposure that compounds across the basket. The portfolio planner takes per-SKU inputs and returns a single quote that reflects the basket, not the line item.",
        meta: 'Multi-SKU · blended duty · lane consolidation · single FX exposure',
        ctas: [
          { label: 'Build a portfolio', href: '/app/portfolio' },
          { label: 'How reproducibility works', href: '/trust#reproducibility', variant: 'ghost' },
        ],
      }}
      steps={{
        label: 'What the portfolio surfaces',
        items: [
          { title: 'Per-line plans', body: 'Each SKU gets its own customs / routing / warehouse plan with the calculator outputs the agent layer can reason over. Per-line drift is detectable on its own snapshot.' },
          { title: 'Blended duty rate', body: 'Weighted by customs value across the basket. Useful when an AD/CVD measure lands on one origin and you need to know the basket-level impact.' },
          { title: 'Lane consolidation savings', body: 'If three SKUs share an origin port and arrive in the same window, the platform aggregates them into one container quote — savings vs three separate bookings surfaced explicitly.' },
          { title: 'Aggregate FX exposure', body: 'All non-EUR settlement priced through one FX leg. Hedge cost computed once, not per SKU. The exposure you would actually take to a bank or hedging desk.' },
        ],
      }}
      closer={{
        label: 'Run a portfolio quote',
        title: 'The portfolio total beats the sum of per-SKU totals.',
        body: 'Once you have three or more SKUs in scope, the consolidation and blended math start mattering. The planner takes the inputs once.',
        ctas: [{ label: 'Open the planner', href: '/app/portfolio' }],
      }}
    />
  );
}
