import { createContext, type CSSProperties, useContext, useState } from 'react';

import { isPersonMe, type PersonIdentity, type ReplayPersonSummary } from '../../shared/people.ts';
import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/utils.ts';

import { copyText } from '../clipboard.ts';
import { hueOf, initialsOf } from '../comments/Avatar.tsx';

/*
 * The people on a feed row (summary.people): an overlapping stack of avatars after the row's source, one tab stop.
 * Hover (300 ms intent), focus + Enter or a tap opens a small card: who they are, their role here, their email to
 * copy and a profile link when the deployment gives one. Rendered only for rows that have people.
 */

/** Who "you" are on the index (signed-in email + linked handles), for "That's you"; set by ReplayIndex. */
export const MeContext = createContext<PersonIdentity>({});

const MAX_SHOWN = 3;

/** Display name: the given one, else the email's local part, else the first handle. */
export function personName(person: ReplayPersonSummary) {
  if (person.name?.trim()) return person.name.trim();
  if (person.email) return person.email.split('@')[0]!;
  return Object.values(person.handles ?? {})[0] ?? 'Someone';
}

/** `pr-author` reads as "Pr author"; a role is the producer's word, shown as plainly as possible. */
export function roleLabel(role: string) {
  const words = role.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const personKey = (person: ReplayPersonSummary, index: number) =>
  `${person.role}:${person.email ?? JSON.stringify(person.handles ?? {})}:${index}`;

const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

/** The deployment's avatar, else the GitHub avatar of the person's `github` handle; undefined when neither exists. */
export function personAvatarSrc(person: ReplayPersonSummary) {
  if (person.avatarUrl && /^https:\/\//i.test(person.avatarUrl)) return person.avatarUrl;
  const login = person.handles?.github;
  return login && GITHUB_LOGIN.test(login) ? `https://github.com/${login}.png?size=48` : undefined;
}

/** The person's avatar (https only) over their initials on a tinted disc, which also shows when the image fails. */
export function PersonAvatar({ person, size = 18 }: { person: ReplayPersonSummary; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = personName(person);
  const image = failed ? undefined : personAvatarSrc(person);
  return (
    <span
      className="person-avatar"
      aria-hidden="true"
      style={{ '--avatar-hue': hueOf(person.email ?? name), '--avatar-size': `${size}px` } as CSSProperties}
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

function CopyEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="person-copy"
      aria-label={copied ? `Copied ${email}` : `Copy ${email}`}
      onClick={() =>
        void copyText(email).then((done) => {
          if (!done) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        })
      }
    >
      <AnimatedIcon name={copied ? 'check' : 'copy'} />
    </button>
  );
}

/** One person: face, name ("That's you" when it is), role, email to copy and the profile link. */
function PersonDetails({ person, compact = false }: { person: ReplayPersonSummary; compact?: boolean }) {
  const me = useContext(MeContext);
  const profile = person.profileUrl && /^https:\/\//i.test(person.profileUrl) ? person.profileUrl : undefined;
  return (
    <div className={cn('person-details', compact && 'person-details-compact')} data-testid="person-details">
      <PersonAvatar person={person} size={compact ? 28 : 40} />
      <div className="person-text">
        <span className="person-name">
          {personName(person)}
          {isPersonMe(person, me) ? <span className="person-me">That’s you</span> : null}
        </span>
        <span className="person-role">{roleLabel(person.role)}</span>
        {person.email || profile ? (
          <span className="person-links">
            {person.email ? (
              <span className="person-email">
                <span className="person-email-text">{person.email}</span>
                <CopyEmail email={person.email} />
              </span>
            ) : null}
            {profile ? (
              <a className="person-link" href={profile} target="_blank" rel="noreferrer">
                Profile
                <AnimatedIcon name="arrow-up-right" />
                <span className="visually-hidden"> of {personName(person)} (opens in a new tab)</span>
              </a>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Up to three overlapping avatars, "+N" beyond, as one button; its card shows one person in full or everyone compactly. */
export function PeopleStack({ people }: { people: readonly ReplayPersonSummary[] | undefined }) {
  const me = useContext(MeContext);
  if (!people?.length) return null;
  const label = `People: ${people
    .map((person) => `${personName(person)}${isPersonMe(person, me) ? ' (you)' : ''}, ${roleLabel(person.role).toLowerCase()}`)
    .join('; ')}`;
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={300} closeDelay={120} className="feed-people" aria-label={label} data-testid="people-stack">
        {people.slice(0, MAX_SHOWN).map((person, index) => (
          <PersonAvatar key={personKey(person, index)} person={person} />
        ))}
        {people.length > MAX_SHOWN ? (
          <span className="person-more" aria-hidden="true">
            +{people.length - MAX_SHOWN}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        className="person-card w-auto max-w-80 gap-0 p-3"
        aria-label={people.length === 1 ? personName(people[0]!) : 'People'}
      >
        {people.length === 1 ? (
          <PersonDetails person={people[0]!} />
        ) : (
          <ul className="person-list">
            {people.map((person, index) => (
              <li key={personKey(person, index)}>
                <PersonDetails person={person} compact />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
