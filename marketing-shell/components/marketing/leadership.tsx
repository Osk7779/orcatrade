import Image from 'next/image';
import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// Names, photos and locations don't translate; role / quote / bio do.
const TEAM_BASE = [
  { name: 'Jay Xie', photo: '/leadership/jay-xie.jpg', location: 'Hong Kong · London' },
  { name: 'Arman Sirin', photo: '/leadership/arman-sirin.png', location: 'Istanbul · London' },
  { name: 'Yiu Cheung', photo: '/leadership/yiu-cheung.png', location: 'Hong Kong' },
  { name: 'Oskar Klepuszewski', photo: '/leadership/oskar-klepuszewski.jpg', location: 'Warsaw · London' },
];

export function Leadership({
  copy = EN_COPY.leadershipSection,
}: {
  copy?: HomepageCopy['leadershipSection'];
}) {
  const team = TEAM_BASE.map((person, i) => ({
    ...person,
    role: copy.members[i].role,
    quote: copy.members[i].quote,
    bio: copy.members[i].bio,
  }));
  return (
    <section
      id="leadership"
      className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6">
        <FadeUp className="mx-auto mb-16 max-w-[760px] text-center">
          <h2
            className="font-serif text-[clamp(2.2rem,3.8vw+0.4rem,3.4rem)] leading-[1.08] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
          >
            {copy.title}
          </h2>
          <p className="mx-auto mt-6 max-w-[58ch] font-serif text-[1.1rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
            {copy.lead}
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2">
          {team.map((person) => (
            <article
              key={person.name}
              className="group relative flex flex-col gap-6 bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:flex-row md:gap-9 md:p-10"
            >
              <div className="relative isolate mx-auto aspect-[4/5] w-full max-w-[220px] shrink-0 overflow-hidden bg-[var(--color-navy)] md:mx-0 md:max-w-[200px]">
                <Image
                  src={person.photo}
                  alt={`${person.name} portrait`}
                  width={400}
                  height={500}
                  className="size-full object-cover grayscale transition-all duration-1000 group-hover:grayscale-0"
                  priority={false}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                  style={{
                    background:
                      'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
                    animation: 'portrait-shine 1.6s ease-out',
                  }}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[var(--color-ink)] via-[var(--color-ink)]/40 to-transparent" />
              </div>

              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <h3
                    className="font-serif text-[1.8rem] leading-tight tracking-[-0.018em] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 600 }}
                  >
                    {person.name}
                  </h3>
                  <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
                    {person.role}
                  </span>
                </div>

                {/* Pull quote — magazine-style: hairline left rule, italic Fraunces,
                    larger than bio so it leads the eye and reads as voice. */}
                <blockquote className="relative border-l border-[var(--color-ivory-dim)]/35 pl-5 font-serif text-[1.1rem] italic leading-[1.45] text-[var(--color-ivory)]">
                  <span aria-hidden className="absolute -left-[2px] top-0 font-serif text-[1.8rem] leading-none text-[var(--color-ivory-dim)]/40">
                    &ldquo;
                  </span>
                  {person.quote}
                </blockquote>

                <p className="max-w-[42ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                  {person.bio}
                </p>
                <div className="mt-auto flex items-center gap-2 text-[11px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                  <span aria-hidden className="size-1 rounded-full bg-[var(--color-ivory-dim)]/70" />
                  {person.location}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
