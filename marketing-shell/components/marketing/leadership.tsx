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
    <section id="leadership" className="bg-[var(--color-navy)] py-20 md:py-24">
      <div className="mx-auto max-w-[1080px] px-6">
        <FadeUp className="mx-auto mb-12 max-w-[720px] text-center">
          <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1.1]">{copy.title}</h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-[17px] leading-[1.5] text-[var(--color-ivory-mute)]">
            {copy.lead}
          </p>
        </FadeUp>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {team.map((person) => (
            <article
              key={person.name}
              className="flex flex-col gap-6 rounded-[22px] bg-white p-8 sm:flex-row md:p-9"
            >
              <div className="aspect-[4/5] w-full shrink-0 overflow-hidden rounded-2xl bg-[var(--color-navy)] sm:w-[150px]">
                <Image
                  src={person.photo}
                  alt={`${person.name} portrait`}
                  width={300}
                  height={375}
                  className="size-full object-cover"
                />
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-[22px] leading-tight tracking-[-0.02em]">{person.name}</h3>
                  <p className="mt-1 text-[14px] text-[var(--color-ivory-mute)]">{person.role}</p>
                </div>
                <p className="text-[16px] font-medium leading-[1.45] text-[var(--color-ivory)]">
                  &ldquo;{person.quote}&rdquo;
                </p>
                <p className="text-[14.5px] leading-[1.55] text-[var(--color-ivory-dim)]">{person.bio}</p>
                <p className="mt-auto text-[12.5px] text-[var(--color-ivory-mute)]">{person.location}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
