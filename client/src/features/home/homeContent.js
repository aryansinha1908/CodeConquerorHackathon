// The home page's copy (pages/HomePage.jsx and features/home/*), in one place. Every claim here is
// something ShareX does: check it against docs/demo.md and How it works before changing it. The
// resources and units named are the seeded ones (server/scripts/seedData.js).

/** The hero's rotating word: what you can book. */
export const HERO_WORDS = ['3D printers', 'oscilloscopes', 'GPU workstations', 'meeting rooms', 'camera drones', 'lathes'];

/** Quick searches under the hero's search box (they open Explore). */
export const QUICK_SEARCH_TAGS = [
  { label: '3D Printers', q: '3D Printer' },
  { label: 'Laser Cutters', q: 'Laser' },
  { label: 'Oscilloscopes', q: 'Oscilloscope' },
  { label: 'Lathes', q: 'Lathe' },
  { label: 'Computing', category: 'computing' },
  { label: 'Rooms', category: 'space' },
];

/** The units scrolling under the hero (the seeded NIT Jamshedpur units). */
export const UNIT_NAMES = [
  'Design and Innovation Centre',
  'Central Workshop',
  'Computer Centre',
  'Central Library',
  "Students' Activities Centre",
  'Centre for Innovation and Incubation',
  'Computer Science and Engineering',
  'Electronics and Communication Engineering',
  'Electrical Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Metallurgical and Materials Engineering',
];

/** The count-up facts. */
export const FACTS = [
  { value: 18, label: 'Campus units', note: 'departments, centres and central facilities', color: '#c0392b' },
  { value: 12, label: 'Rules checked', note: 'before you send a request, each one explained', color: '#183d2d' },
  { value: 15, label: 'Minutes', note: 'before your slot, check-in opens', color: '#2471a3' },
  { value: 2, label: 'Minutes', note: 'each QR pass stays valid (a new one comes every minute)', color: '#b9470b' },
];

/** The rules ticked off in the "Know before you book" card. */
export const CHECKLIST_DEMO = ['Account verified', 'Badge: 3D Printing Basics', 'Inside opening hours', 'Weekly hours left'];

/** The notifications streaming in the "Every step on record" card (examples). */
export const ACTIVITY_DEMO = [
  { id: 'a1', title: 'Request approved', detail: 'FDM 3D Printer · Tue 10:00–12:00', color: '#1e7e45' },
  { id: 'a2', title: 'Pass verified at pickup', detail: 'Design and Innovation Centre', color: '#2471a3' },
  { id: 'a3', title: 'Checked out with 2 photos', detail: 'Condition: good', color: '#183d2d' },
  { id: 'a4', title: 'Return confirmed', detail: 'All good · booking completed', color: '#8e44ad' },
  { id: 'a5', title: "You're #1 on the waitlist", detail: 'Meeting Room · Wed 14:00', color: '#b9470b' },
];

/** The booking lifecycle (the timeline). */
export const LIFECYCLE = [
  {
    title: 'Join and verify',
    body: 'Sign up with your @nitjsr.ac.in email and confirm the 6-digit code. Then upload your institute ID card: an admin checks it, and a quick check on your own device tells you straight away whether the photo is readable. The image is deleted once the admin decides.',
    tags: ['Email code', 'Human ID review', 'On-device check'],
  },
  {
    title: 'Find and check',
    body: 'Search by keyword, or describe what you need and let AI suggest matches. Each resource shows who can book it and when it is free. Before you send a request, the 12 rules run on your slot, and anything missing is explained, most of it with how to fix it.',
    tags: ['Keyword or AI search', 'Live availability', '12 rules'],
  },
  {
    title: 'Request',
    body: 'Where the unit allows it, a request is approved at once. Otherwise one of its managers decides, and a refusal always says why. If the slot is already held, you can join a first-come waitlist: when it frees up, the next person in line who still meets the rules moves up.',
    tags: ['Instant or manager approval', 'Refusals give a reason', 'Fair waitlist'],
  },
  {
    title: 'Pick up',
    body: 'Show your QR pass at the counter: it refreshes every minute and the unit scans it. Check-in opens 15 minutes before your slot: go through the checklist, and add photos of the item as you found it. A booking not checked in 15 minutes after its start becomes a no-show.',
    tags: ['QR pass', 'Checklist, photos if you add them', 'No-show rule'],
  },
  {
    title: 'Return',
    body: 'Check out with the same checklist and, ideally, fresh photos. The unit compares them with the pickup (with photos at both, AI can point out differences) and confirms the return: all good, or an issue.',
    tags: ['Condition reports', 'AI photo comparison', 'Manager confirms'],
  },
  {
    title: 'Settle',
    body: 'Damage, delays or misuse open an incident that a person resolves with a written outcome. Every step lands in your booking’s timeline and the audit log.',
    tags: ['Human review', 'Timeline', 'Audit log'],
  },
];

/** What each role does. */
export const ROLES = [
  {
    role: 'Students and scholars',
    summary: 'Find equipment and rooms, see what you still need, and book.',
    points: ['Earn the training badges risky equipment needs', 'Track requests and your waitlist place', 'Show a QR pass at pickup'],
    color: '#c0392b',
  },
  {
    role: 'Faculty',
    summary: 'Book everything students can, plus what is kept for PG, scholars and faculty.',
    points: ['Survey and lab instruments', 'Meeting rooms for project teams', 'The same fair-use limits'],
    color: '#183d2d',
  },
  {
    role: 'Unit managers',
    summary: 'List your unit’s resources with their own rules, and run the counter.',
    points: ['Decide requests grouped by slot', 'Scan passes, confirm returns', 'Grant badges, resolve low and medium incidents'],
    color: '#2471a3',
  },
  {
    role: 'Admins',
    summary: 'Keep the platform trustworthy across every unit.',
    points: ['Review ID cards', 'See every unit’s incidents', 'Read the full audit log'],
    color: '#8e44ad',
  },
];

/** The units section (the seeded resources each one lists). */
export const UNITS = [
  {
    code: 'DIC',
    name: 'Design and Innovation Centre',
    focus: 'An FDM 3D printer and a CO₂ laser cutter, each after its own training badge.',
    badge: 'Badge required',
    q: '3D printer',
  },
  {
    code: 'CW',
    name: 'Central Workshop',
    focus: 'A centre lathe and an arc welding bay, open after the workshop safety induction.',
    badge: 'Safety induction',
    q: 'lathe',
  },
  {
    code: 'CC',
    name: 'Computer Centre',
    focus: 'A GPU workstation for training and simulation, under the GPU usage policy.',
    badge: 'Instant approval',
    q: 'GPU',
  },
  {
    code: 'ECE',
    name: 'Electronics and Communication Engineering',
    focus: 'A digital storage oscilloscope for lab work, with the electronics lab safety badge.',
    badge: 'Instant approval',
    q: 'oscilloscope',
  },
];

/** Things people book resources for (examples, matched to the seeded resources). */
export const USE_CASES = [
  { task: 'Print chassis brackets for the robotics club', resource: 'FDM 3D Printer', unit: 'DIC' },
  { task: 'Cut acrylic panels for a design project', resource: 'CO₂ Laser Cutter', unit: 'DIC' },
  { task: 'Train a model on a proper GPU', resource: 'GPU Workstation', unit: 'Computer Centre' },
  { task: 'Debug a signal for a circuits assignment', resource: 'Digital Storage Oscilloscope', unit: 'ECE' },
  { task: 'Hold a team stand-up with a whiteboard', resource: 'Discussion Room A', unit: 'Central Library' },
  { task: 'Shoot aerial footage over the open sports ground', resource: 'Camera Drone', unit: "Students' Activities Centre" },
  { task: 'Survey a site for a civil project', resource: 'Total Station', unit: 'Civil Engineering' },
  { task: 'Prototype IoT sensors over a long weekend', resource: 'IoT Starter Kit', unit: 'CSE · a loan of up to 3 days' },
];

/** The FAQ. */
export const FAQS = [
  {
    q: 'Who can use ShareX?',
    a: 'Anyone with an @nitjsr.ac.in email: students, research scholars, faculty and staff. You confirm your email with a code, and an admin checks your institute ID card before your first booking.',
  },
  {
    q: 'Is my ID card shared with anyone?',
    a: 'Only administrators can open it, through a link that expires in 5 minutes, and every view is logged. The image is deleted once they decide. The optional check on your device reads the card there and sends only yes/no answers.',
  },
  {
    q: 'What if someone else wants the same slot?',
    a: 'The earlier request holds it. You can join the waitlist: if the slot frees up, the next person in line who still meets the rules moves up and is told, and their request then goes through like any other (approved at once where the unit allows it).',
  },
  {
    q: 'What happens if I don’t turn up?',
    a: 'Check-in opens 15 minutes before your slot. If you haven’t checked in 15 minutes after the start, the booking becomes a no-show and the slot is freed for others.',
  },
  {
    q: 'What does the AI see?',
    a: 'AI search sends Google Gemini your question and the list of resources, with emails, roll numbers and phone numbers taken out; never your name or bookings. The photo comparison sends equipment photos and checklist labels. Its answers are suggestions: a person decides.',
  },
  {
    q: 'Why was my request refused?',
    a: 'Every refusal comes with a reason. The eligibility checklist also names each rule you don’t meet yet, most with how to fix it, such as a training badge to request.',
  },
];
