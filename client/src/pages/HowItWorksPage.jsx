import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Camera,
  ClipboardCheck,
  Eye,
  FileClock,
  IdCard,
  ListOrdered,
  Scale,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { FadeUp, StaggerItem, StaggerList } from '../components/Motion';
import { useAuthStore } from '../stores/auth';

// /how-it-works (frontend.md §6.1, FC-01): how allocation works, in plain words, for members, judges
// and anyone who hasn't signed in. Static on purpose: no API calls, so the page never sends a signed-out
// visitor to the login page (lib/http.js), and it loads while the API is asleep. The numbers below are
// the server's (engines/stateMachine.js, jobs/sweeper.js, engines/eligibility.js): change them together.

const card =
  'rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a]';

// The 12 checks of engines/eligibility.js RULES, in the server's order.
const RULES = [
  ['Verified account', 'An admin has approved your institute ID card.'],
  ['Not suspended', 'Your account isn’t under a suspension.'],
  ['Resource open', 'The resource is active, not under maintenance or retired.'],
  ['Member type', 'The resource is open to your member type (for example UG, PG, faculty).'],
  ['Department', 'Some resources are only for certain departments.'],
  ['Training badges', 'You hold every badge the resource needs, and none has expired.'],
  ['Opening hours', 'The slot is inside the resource’s weekly hours and not on a closure.'],
  ['Length', 'The booking is between the shortest and longest the unit allows.'],
  ['Booking window', 'Booked far enough ahead (lead time), and not too far ahead.'],
  ['Weekly hours', 'Your hours on this resource this week stay within its cap.'],
  ['Active bookings', 'You hold no more pending, approved or in-use bookings here than allowed.'],
  ['Availability', 'Someone may already hold the slot. Then you can join the waitlist instead.'],
];

function Section({ icon: Icon, title, children }) {
  return (
    <StaggerItem as="section" className={card}>
      <h2 className="text-lg font-black tracking-tight flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5 text-[#a93226]" aria-hidden="true" />
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </StaggerItem>
  );
}

export default function HowItWorksPage() {
  const signedIn = useAuthStore((s) => Boolean(s.user));
  return (
    <div className="min-h-screen bg-[#f5f0e8] text-[#1a1a1a] font-mono">
      <a href="#how-main" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b-2 border-[#1a1a1a] bg-[#f5f0e8]">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-[#c0392b] border-2 border-[#1a1a1a] rounded-lg shadow-[2px_2px_0_#1a1a1a] flex items-center justify-center font-black text-white">
              SX
            </span>
            <span className="text-base font-black tracking-tight">ShareX</span>
          </Link>
          <Link
            to="/explore"
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-md border-2 border-[#1a1a1a] bg-white text-xs font-bold shadow-[2px_2px_0_#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
          >
            {signedIn ? 'Back to the app' : 'Open the app'}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="how-main" className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <FadeUp as="section" className="rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d] text-white p-6 md:p-8 shadow-[6px_6px_0_#1a1a1a]">
          <p className="mb-3">
            <span className="px-2.5 py-0.5 rounded border border-white/40 bg-[#c0392b] text-[10px] font-black tracking-widest uppercase">
              How allocation works
            </span>
          </p>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight mb-3">
            Fair, explained and checked by people
          </h1>
          <p className="text-sm text-white/90 leading-relaxed max-w-2xl">
            Departments and central facilities at NIT Jamshedpur share their spaces, equipment and computing
            through ShareX. Every booking is checked against published rules, every decision has a
            reason you can read, and a person always has the last word on anything that affects you.
          </p>
        </FadeUp>

        <StaggerList as="div" className="space-y-6" step={0.06}>
          <Section icon={IdCard} title="1. Who can join">
            <p>
              Only <span className="font-bold">@nitjsr.ac.in</span> addresses can register, confirmed with a
              6-digit email code. Then you upload your institute ID card, and an admin checks it by hand.
            </p>
            <p>
              Your ID card is stored privately. Only admins can open it, through a link that works for 5 minutes,
              and every viewing is logged. It&apos;s deleted once the admin decides. The &quot;likely valid&quot;
              check of your card runs on your own device: the image is never sent to an AI service.
            </p>
          </Section>

          <Section icon={ClipboardCheck} title="2. The 12 checks behind every booking">
            <p>Each resource page shows these checks for you, with what to do about any that fail:</p>
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2 list-decimal list-inside">
              {RULES.map(([name, text]) => (
                <li key={name}>
                  <span className="font-bold">{name}:</span> {text}
                </li>
              ))}
            </ol>
          </Section>

          <Section icon={BadgeCheck} title="3. Approval">
            <p>
              Each unit chooses per resource. <span className="font-bold">Instant approval</span> books you at once
              when every check passes. <span className="font-bold">Manager approval</span> sends the request to the
              unit&apos;s managers, who see competing requests side by side, oldest first. Rejecting or waitlisting a
              request needs a written reason, which you see. A manager can&apos;t decide on their own booking:
              another manager of the unit, or an admin, does.
            </p>
            <p>A request nobody decided by its start time expires, so it stops counting against your limits.</p>
          </Section>

          <Section icon={Scale} title="4. Fair-use limits">
            <p>
              Units set the shortest and longest booking, how many hours one member may book a week (Monday to
              Sunday, IST), how many bookings you may hold at once, and how far ahead you can book. Each resource page
              shows your own usage against them.
            </p>
          </Section>

          <Section icon={ListOrdered} title="5. The waitlist">
            <p>
              When an earlier request holds your slot, you can join the waitlist. It&apos;s first come, first served:
              when the slot frees up (a cancellation, a rejection, a no-show), the oldest waiting request that still
              fits moves up and you&apos;re notified. A waitlisted request that never moves up expires at its start.
            </p>
          </Section>

          <Section icon={CalendarClock} title="6. Pickup, no-shows and returns">
            <p>
              You get a reminder 60 minutes before your booking starts and 15 minutes before it ends. Check-in opens
              15 minutes before the start. If you haven&apos;t checked in 15 minutes after the start, the booking
              becomes a no-show and the slot is offered to the waitlist.
            </p>
            <p>
              At pickup you can show the unit a QR pass from your booking page; they scan it to confirm it&apos;s you,
              at the right time. An item not returned 15 minutes after the end is marked overdue, and the unit is told.
            </p>
          </Section>

          <Section icon={Camera} title="7. Condition, before and after">
            <p>
              At check-in and check-out you tick the resource&apos;s condition checklist and can add photos. When you
              return it, a manager compares the two reports and either confirms the return or reports an issue. The
              manager can ask AI to point out differences between the photos: it&apos;s labelled as a suggestion, and
              the manager decides.
            </p>
          </Section>

          <Section icon={TriangleAlert} title="8. Incidents and human review">
            <p>
              Damage, misuse, safety problems, conflicts and late returns become incidents with a discussion thread. Unit managers
              resolve low and medium ones; admins resolve high ones. Every resolution has a written rationale and an
              outcome (no action, a warning, a repair, or a strike), and the people involved are notified.
            </p>
          </Section>

          <Section icon={FileClock} title="9. Everything is recorded">
            <p>
              Each step (a request, a decision and its reason, a check-in, a return, an incident) goes into an
              append-only audit log with who did it and when. You can read your own booking&apos;s full history on its
              page; admins and unit managers can search the log.
            </p>
          </Section>

          <Section icon={Sparkles} title="10. What the AI sees, and what it never sees">
            <p>
              AI search and the photo comparison use Google Gemini. It receives your search question, the public
              details of the resources (title, unit, description, badges) and the equipment photos of a return. It
              never receives ID cards, names, emails or roll numbers. AI use has a daily limit, and when AI is
              unavailable the regular search still works.
            </p>
            <p>
              The prototype uses Gemini&apos;s free tier, where Google may use what it receives to improve its
              products, and people at Google may read it.
            </p>
            <p className="flex items-start gap-2">
              <Eye className="w-4 h-4 mt-0.5 shrink-0 text-[#183d2d]" aria-hidden="true" />
              <span>Don&apos;t type personal details into the AI search.</span>
            </p>
          </Section>

          <Section icon={ShieldCheck} title="An independent prototype">
            <p>
              ShareX was built for a hackathon. It isn&apos;t affiliated with NIT Jamshedpur, and every seeded
              person and item is fictional. The demo buttons on the sign-in page let you try each role without an
              account.
            </p>
          </Section>
        </StaggerList>

        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            to="/explore"
            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-md border-2 border-[#1a1a1a] bg-[#c0392b] text-white text-sm font-bold shadow-[3px_3px_0_#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a1a1a] focus-visible:ring-offset-2"
          >
            Explore resources
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          {/* The store only: no API call on this public page (lib/http.js). */}
          {!signedIn && (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-md border-2 border-[#1a1a1a] bg-white text-sm font-bold shadow-[3px_3px_0_#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
