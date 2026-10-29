import { matchPath } from 'react-router-dom';

// The guided tour (frontend.md §3 FC-03): a few steps per page, pointing at elements marked
// data-tour="…". Each step names its target; a step whose target isn't on the page right now (an empty
// list, a section the viewer's role doesn't see) is skipped when the tour starts. A step without a
// target is a centred note. Keep the text short: one idea per step. The member /badges page and the
// home page are a teammate's, so they have no tour here.

export const TOURS = [
  {
    id: 'explore',
    path: '/explore',
    title: 'Explore',
    steps: [
      { title: 'Welcome to CampusCommons', text: 'Book spaces, equipment and computing across NIT Jamshedpur. This tour shows each page in a few steps; open it again any time with the ? button.' },
      { target: 'explore-search', title: 'Search the catalogue', text: 'Type what you need. Switch on "Ask in your own words" to let AI find matches for a description.' },
      { target: 'explore-categories', title: 'Filter by kind', text: 'Spaces, equipment, computing and tools. The unit menu narrows it to one department or facility.' },
      { target: 'explore-eligible', title: 'Only what you can book', text: 'Hides resources whose rules you don’t meet yet, such as a missing training badge.' },
      { target: 'explore-results', title: 'Open a resource', text: 'Each card shows the unit, risk level, approval mode and badges needed. Click anywhere on a card to book it.' },
      { target: 'header-bell', title: 'Notifications', text: 'Decisions, reminders and incident updates arrive here.' },
      { target: 'header-account', title: 'Your account', text: 'Your profile, ID verification and, for admins, the admin console. "How it works" explains every rule.' },
    ],
  },
  {
    id: 'resource',
    path: '/resources/:id',
    title: 'A resource',
    steps: [
      { target: 'resource-header', title: 'What it is', text: 'Unit, location, opening hours, risk level and how requests are approved.' },
      { target: 'resource-rules', title: 'The rules', text: 'Usage rules, who can book, the limits and the handover checklist. On a wide screen they stay in view while you scroll.' },
      { target: 'resource-eligibility', title: 'Can you book it?', text: 'The server checks your account against each rule and says how to fix any that fail. Your weekly quota is here too.' },
      { target: 'resource-availability', title: 'Pick a time', text: 'Free slots for the next 7 days, in IST. Click a start, then an end.' },
      { target: 'resource-panel', title: 'Request it', text: 'Every rule is checked again live for the exact slot. Add a purpose and send; if someone holds the slot, join the waitlist.' },
    ],
  },
  {
    id: 'bookings',
    path: '/bookings',
    title: 'My bookings',
    steps: [
      { target: 'bookings-tabs', title: 'Your bookings', text: 'Upcoming ones, requests waiting for a decision (with your waitlist position) and past ones.' },
      { target: 'bookings-list', title: 'Open one', text: 'Its page has the actions you can take now, its condition reports and its full history.' },
    ],
  },
  {
    id: 'booking',
    path: '/bookings/:id',
    title: 'A booking',
    steps: [
      { target: 'booking-actions', title: 'What you can do now', text: 'Cancel, check in (from 15 minutes before the start), check out, or report an issue. At pickup, show the unit your QR pass.' },
      { target: 'booking-status', title: 'Status and decision', text: 'Where the booking stands, and the reason a manager gave for any decision.' },
      { target: 'booking-reports', title: 'Condition reports', text: 'The checklist and photos from check-in and check-out.' },
      { target: 'booking-history', title: 'Full history', text: 'Every step, who took it and when. Nothing is ever deleted.' },
    ],
  },
  {
    id: 'dashboard',
    path: '/manage',
    title: 'Manage',
    steps: [
      { target: 'manage-tabs', title: 'The management console', text: 'Requests to decide, today’s handovers, your resources, incidents and badge requests.' },
      { target: 'dashboard-counts', title: 'What needs you', text: 'How many items wait in each list. Click a card to open it.' },
    ],
  },
  {
    id: 'requests',
    path: '/manage/requests',
    title: 'Booking requests',
    steps: [
      { target: 'requests-groups', title: 'Conflict groups', text: 'Requests for the same slot share one card, oldest first, with the eligibility each had when it was made.' },
      { target: 'request-actions', title: 'Decide', text: 'Approve, waitlist or reject. Rejecting or waitlisting needs a reason, which the requester sees.' },
    ],
  },
  {
    id: 'handovers',
    path: '/manage/handovers',
    title: 'Handovers',
    steps: [
      { target: 'handovers-starting', title: 'Starting soon', text: 'Today’s pickups. Scan a borrower’s QR pass on the Scan tab to confirm it’s them.' },
      { target: 'handovers-inUse', title: 'In use', text: 'Items out now. Overdue ones are highlighted.' },
      { target: 'handovers-returns', title: 'Returns to confirm', text: 'Compare the borrower’s check-in and check-out reports, then confirm the return or report an issue.' },
    ],
  },
  {
    id: 'return',
    path: '/manage/returns/:bookingId',
    title: 'Confirm a return',
    steps: [
      { target: 'return-compare', title: 'Before and after', text: 'The check-in and check-out checklists and photos side by side. AI can point out differences; you decide.' },
      { target: 'return-form', title: 'Your check', text: 'Tick your own checklist, then confirm the return, or report an issue to open an incident.' },
    ],
  },
  {
    id: 'verifications',
    path: '/admin/verifications',
    title: 'ID verification',
    steps: [
      { target: 'verifications-queue', title: 'The queue', text: 'Members waiting for their ID card to be checked, with what their email address suggests.' },
      { target: 'verification-view', title: 'View the card', text: 'Opens through a link that works for 5 minutes, and every viewing is logged.' },
      { target: 'verification-decide', title: 'Decide', text: 'Approve with the member type and department, or reject with a reason the member sees.' },
    ],
  },
];

/** The tour for `pathname`, or null. Exact matches only: /bookings/:id/check-in has none. */
export function tourFor(pathname) {
  return TOURS.find((tour) => matchPath({ path: tour.path, end: true }, pathname)) ?? null;
}

/** Every data-tour id the tours use (the tests check each one exists in the source). */
export const tourTargets = () => [...new Set(TOURS.flatMap((t) => t.steps.map((s) => s.target).filter(Boolean)))];
