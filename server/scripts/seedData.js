// The data behind `npm run seed` (backend.md §9 "Seed data"). Real NIT Jamshedpur unit names and
// codes from architecture.md §1.2; every person, roll number, room and piece of inventory is
// fictional (architecture.md §1.2 "Data ethics", hackathon rules 9 and 10).
//
// Units, badges and departments are referred to by code here; scripts/seed.js resolves the codes to
// ids. seed.js resets every field defined here on each run and leaves the others alone (a
// resource's images, a unit's location), so a re-run puts the golden path (frontend.md §11) back.

export const DEMO_DOMAIN = "demo.campuscommons.test";

export const demoEmail = (login) => `${login}@${DEMO_DOMAIN}`;

// ── Org units (architecture.md §1.2) ────────────────────────────────────────

// Full names as the institute writes them; §1.2's table abbreviates some ("CSE", "Electrical").
export const ORG_UNITS = [
  {
    code: "cse",
    name: "Computer Science and Engineering",
    type: "department",
  },
  {
    code: "ece",
    name: "Electronics and Communication Engineering",
    type: "department",
  },
  { code: "ee", name: "Electrical Engineering", type: "department" },
  { code: "mech", name: "Mechanical Engineering", type: "department" },
  { code: "civil", name: "Civil Engineering", type: "department" },
  {
    code: "mme",
    name: "Metallurgical and Materials Engineering",
    type: "department",
  },
  {
    code: "prod",
    name: "Production and Industrial Engineering",
    type: "department",
  },
  { code: "chem", name: "Chemistry", type: "department" },
  { code: "phys", name: "Physics", type: "department" },
  { code: "maths", name: "Mathematics", type: "department" },
  { code: "mca", name: "Computer Applications", type: "department" },
  {
    code: "hssm",
    name: "Humanities, Social Sciences and Management",
    type: "department",
  },
  { code: "dic", name: "Design and Innovation Centre", type: "centre" },
  {
    code: "ciic",
    name: "Centre for Innovation and Incubation",
    type: "centre",
  },
  { code: "cw", name: "Central Workshop", type: "central_facility" },
  { code: "cc", name: "Computer Centre", type: "central_facility" },
  { code: "lib", name: "Central Library", type: "central_facility" },
  {
    code: "sac",
    name: "Students' Activities Centre",
    type: "central_facility",
  },
];

// ── Badges (backend.md §9) ──────────────────────────────────────────────────

// "1 year" is 365 days and "6 months" 180. selfServe is set directly here: createBadge refuses it
// until the quiz (C-13) exists (progress.md §5 "Badges").
export const BADGES = [
  {
    code: "workshop-safety-induction",
    name: "Workshop Safety Induction",
    issuer: "cw",
    validityDays: 365,
    selfServe: false,
    description:
      "An in-person induction on machine guards, protective gear, swarf and emergency stops. Needed for every machine in the Central Workshop.",
  },
  {
    code: "3d-printing-basics",
    name: "3D Printing Basics",
    issuer: "dic",
    validityDays: 365,
    selfServe: false,
    description:
      "Slicing a model, levelling the bed, changing filament and removing prints safely on the DIC's FDM printers.",
  },
  {
    code: "laser-cutter-operation",
    name: "Laser Cutter Operation",
    issuer: "dic",
    validityDays: 180,
    selfServe: false,
    description:
      "Safe materials, focusing, the fume extractor and fire response for the DIC's CO₂ laser cutter.",
  },
  {
    code: "gpu-usage-policy",
    name: "GPU Usage Policy",
    issuer: "cc",
    validityDays: 365,
    selfServe: true,
    description:
      "The Computer Centre's rules for shared GPU workstations: fair use, data storage and what may run on them.",
  },
  {
    code: "electronics-lab-safety",
    name: "Electronics Lab Safety",
    issuer: "ece",
    validityDays: 365,
    selfServe: true,
    description:
      "Mains safety, ESD precautions and correct use of probes and supplies in the ECE electronics labs.",
  },
  {
    code: "survey-instrument-training",
    name: "Survey Instrument Training",
    issuer: "civil",
    validityDays: 365,
    selfServe: false,
    description:
      "Setting up, levelling and packing the Civil department's total station and its accessories.",
  },
  {
    code: "drone-flight-safety",
    name: "Drone Flight Safety",
    issuer: "sac",
    validityDays: 180,
    selfServe: false,
    description:
      "Pre-flight checks, the campus no-fly areas and battery handling for the SAC's camera drone.",
  },
];

// ── Resources (backend.md §9) ───────────────────────────────────────────────

const MON_TO_SAT = [1, 2, 3, 4, 5, 6]; // 0 = Sunday
const weekly = (open, close, days = MON_TO_SAT) =>
  days.map((day) => ({ day, open, close }));

// "All" in §9 is every member type: the resource form requires at least one (backend.md §7
// resources.create), so a seeded listing opens in the edit form without an error.
const ALL_MEMBERS = ["ug", "pg", "rs", "faculty", "staff"];
const SENIOR_MEMBERS = ["pg", "rs", "faculty"];

const HOUR = 60;
const DAY = 24 * HOUR;

// §9 gives the approval mode and the caps it names (max length, hours a week, active bookings);
// minimum length, lead time and how far ahead are filled in here. No weekly-hour cap on loans: a
// three-day loan counts 72 hours against it (engines/eligibility.js WEEKLY_HOURS).
export const RESOURCES = [
  {
    orgUnit: "dic",
    title: "FDM 3D Printer",
    description:
      "Single-nozzle FDM printer with a 250 × 210 × 220 mm build volume and a removable textured steel sheet. Prints PLA and PETG; bring your model sliced or slice it on the lab PC.",
    category: "equipment",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "medium",
    location: {
      building: "Design and Innovation Centre",
      room: "Prototyping Lab",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["3d-printing-basics"],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 4 * HOUR,
      maxHoursPerWeek: 6,
      maxActiveBookings: 1,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "PLA and PETG only; no ABS or resin. Stay with the printer until the first layer is down. Remove your print and clean the sheet before your slot ends; unfinished prints are taken off for the next booking.",
    checklist: [
      "Nozzle clean",
      "Build plate undamaged",
      "Filament spool mounted",
      "Print area clear",
    ],
  },
  {
    orgUnit: "dic",
    title: "CO₂ Laser Cutter",
    description:
      "60 W CO₂ laser with a 600 × 400 mm honeycomb bed for cutting and engraving acrylic, plywood, MDF, card and leather.",
    category: "equipment",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "high",
    location: {
      building: "Design and Innovation Centre",
      room: "Fabrication Lab",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["laser-cutter-operation"],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 2 * HOUR,
      maxHoursPerWeek: 4,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Sheets up to 6 mm thick. Never cut PVC, vinyl or polycarbonate: they give off toxic fumes. Keep the lid closed and the extractor on, and never leave a job running unattended.",
    checklist: [
      "Lens clean",
      "Honeycomb bed clear of offcuts",
      "Fume extractor running",
      "Fire extinguisher in place",
    ],
  },
  {
    orgUnit: "cw",
    title: "Centre Lathe",
    description:
      "Geared-head centre lathe (1 m between centres) for turning, facing, threading and drilling mild steel, aluminium and brass.",
    category: "tool",
    bookingMode: "slot",
    quantity: 2,
    riskLevel: "high",
    location: {
      building: "Central Workshop",
      room: "Machine Shop",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["workshop-safety-induction"],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: HOUR,
      maxDurationMins: 3 * HOUR,
      maxHoursPerWeek: 6,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Safety shoes, goggles and a fitted apron. No gloves, loose sleeves or jewellery near the chuck. A workshop technician must be present. Clear swarf with a brush, never by hand.",
    checklist: [
      "Chuck key removed",
      "Guards in place",
      "Swarf cleared",
      "Coolant level OK",
    ],
  },
  {
    orgUnit: "cw",
    title: "Arc Welding Bay",
    description:
      "Screened bay with an inverter arc welder, bench, vice and extraction hood for mild-steel fabrication.",
    category: "tool",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "high",
    location: {
      building: "Central Workshop",
      room: "Welding Shop",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["workshop-safety-induction"],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 2 * HOUR,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Wear the helmet, leather gloves and apron provided. Mild steel only. Keep the screen closed while welding and leave hot work to cool on the bench, never in the bin.",
    checklist: [
      "Welding screen closed",
      "Earth clamp undamaged",
      "Cables free of cuts",
      "Fire bucket filled",
    ],
  },
  {
    orgUnit: "cc",
    title: "GPU Workstation",
    description:
      "Linux workstation with a 24 GB GPU, 64 GB RAM and CUDA, PyTorch and TensorFlow installed. For training and running models for coursework and research.",
    category: "computing",
    bookingMode: "slot",
    quantity: 2,
    riskLevel: "low",
    location: {
      building: "Computer Centre",
      room: "GPU Lab",
      floor: "First",
    },
    availability: { weekly: weekly("08:00", "20:00"), slotMinutes: 60 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["gpu-usage-policy"],
      approvalMode: "auto",
    },
    limits: {
      minDurationMins: HOUR,
      maxDurationMins: 8 * HOUR,
      maxHoursPerWeek: 16,
      maxActiveBookings: 1,
      leadTimeMins: 30,
      maxAdvanceDays: 7,
    },
    usageRules:
      "Coursework and research only; no cryptocurrency mining. Keep your data in your home folder: the scratch disk is wiped every Sunday. Jobs still running when your slot ends are stopped.",
    checklist: [
      "Previous session logged out",
      "Scratch disk cleared",
      "Keyboard and mouse present",
    ],
  },
  {
    orgUnit: "ece",
    title: "Digital Storage Oscilloscope",
    description:
      "Four-channel 200 MHz digital storage oscilloscope with passive probes, for signal measurements in projects and lab work.",
    category: "equipment",
    bookingMode: "slot",
    quantity: 3,
    riskLevel: "low",
    location: {
      building: "Electronics and Communication Engineering",
      room: "Electronics Lab",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["electronics-lab-safety"],
      approvalMode: "auto",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 3 * HOUR,
      leadTimeMins: HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Use it on the lab bench; it doesn't leave the room. Check probe attenuation before measuring and never connect a probe's ground clip to mains.",
    checklist: ["Four probes present", "Power cord undamaged", "Screen intact"],
  },
  {
    orgUnit: "cse",
    title: "IoT Starter Kit",
    description:
      "A boxed kit with a Wi-Fi microcontroller board, a breadboard, jumper wires and a pack of common sensors (temperature, humidity, motion, distance, light).",
    category: "equipment",
    bookingMode: "loan",
    quantity: 5,
    riskLevel: "low",
    location: {
      building: "Computer Science and Engineering",
      room: "Embedded Systems Lab",
      floor: "Second",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: [],
      approvalMode: "auto",
    },
    limits: {
      minDurationMins: HOUR,
      maxDurationMins: 3 * DAY,
      maxActiveBookings: 1,
      leadTimeMins: HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Return the kit complete in its box. Report a missing or broken part when you check out, and don't swap parts between kits.",
    checklist: [
      "Microcontroller board",
      "Sensor pack complete",
      "USB cable",
      "Breadboard and jumper wires",
    ],
  },
  {
    orgUnit: "civil",
    title: "Total Station",
    description:
      "Electronic total station with tripod, prism and pole, for field surveys and site layout in projects and theses.",
    category: "equipment",
    bookingMode: "loan",
    quantity: 1,
    riskLevel: "medium",
    location: {
      building: "Civil Engineering",
      room: "Surveying Lab",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: SENIOR_MEMBERS,
      departments: [],
      badges: ["survey-instrument-training"],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 2 * HOUR,
      maxDurationMins: 2 * DAY,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Carry it in its case, never on the tripod. Keep it out of the rain. Charge the battery before you return it.",
    checklist: [
      "Instrument case latched",
      "Tripod complete",
      "Battery charged",
      "Prism and pole present",
    ],
  },
  {
    orgUnit: "mme",
    title: "Optical Microscope",
    description:
      "Inverted metallurgical microscope with 5× to 100× objectives and a camera, for studying polished and etched samples.",
    category: "equipment",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "low",
    location: {
      building: "Metallurgical and Materials Engineering",
      room: "Metallography Lab",
      floor: "First",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: SENIOR_MEMBERS,
      departments: [],
      badges: [],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 3 * HOUR,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Bring samples polished and dry. Use immersion oil only with the 100× objective and clean it off afterwards. Save images to your own drive.",
    checklist: ["Objectives clean", "Lamp works", "Stage clips present"],
  },
  {
    orgUnit: "lib",
    title: "Discussion Room A",
    description:
      "Glass-walled room for up to 8 people with a whiteboard and a wall screen with HDMI.",
    category: "space",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "low",
    location: {
      building: "Central Library",
      room: "Discussion Room A",
      floor: "First",
    },
    availability: { weekly: weekly("08:00", "20:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: [],
      approvalMode: "auto",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 2 * HOUR,
      maxHoursPerWeek: 4,
      leadTimeMins: 30,
      maxAdvanceDays: 7,
    },
    usageRules:
      "Keep your voice down; the reading hall is next door. No food. Leave the room as you found it.",
    checklist: ["Whiteboard wiped", "Chairs in place", "Screen switched off"],
  },
  {
    orgUnit: "sac",
    title: "DSLR Camera Kit",
    description:
      "APS-C DSLR with an 18–55 mm lens, two batteries, a charger, a 64 GB card and a shoulder bag. For club events and student media.",
    category: "equipment",
    bookingMode: "loan",
    quantity: 2,
    riskLevel: "low",
    location: {
      building: "Students' Activities Centre",
      room: "Media Room",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: [],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 2 * HOUR,
      maxDurationMins: 2 * DAY,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Copy your photos off the card and format it before you return the kit. Keep the camera in its bag when you aren't shooting.",
    checklist: [
      "Camera body",
      "18–55 mm lens",
      "Two batteries and charger",
      "Memory card",
    ],
  },
  {
    orgUnit: "sac",
    title: "Camera Drone",
    description:
      "Foldable camera drone under 250 g with a 4K camera, remote controller and three batteries.",
    category: "equipment",
    bookingMode: "loan",
    quantity: 1,
    riskLevel: "high",
    location: {
      building: "Students' Activities Centre",
      room: "Media Room",
      floor: "Ground",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: ["drone-flight-safety"],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 2 * HOUR,
      maxDurationMins: DAY,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 14,
    },
    usageRules:
      "Fly only over the open sports ground, in daylight and within sight, never over people, hostels or roads. Land when a battery reaches 20%.",
    checklist: [
      "Drone and four propellers",
      "Remote controller",
      "Three batteries charged",
      "Carry case",
    ],
  },
  {
    orgUnit: "ciic",
    title: "Meeting Room",
    description:
      "Meeting room for up to 12 people with a projector, a whiteboard and video-call equipment, for startup teams and mentor meetings.",
    category: "space",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "low",
    location: {
      building: "Centre for Innovation and Incubation",
      room: "Meeting Room",
      floor: "First",
    },
    availability: { weekly: weekly("09:00", "17:00"), slotMinutes: 30 },
    eligibility: {
      memberTypes: ALL_MEMBERS,
      departments: [],
      badges: [],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 30,
      maxDurationMins: 3 * HOUR,
      leadTimeMins: 2 * HOUR,
      maxAdvanceDays: 30,
    },
    usageRules:
      "Say in your booking's purpose who you are meeting. Switch off the projector and wipe the whiteboard when you leave.",
    checklist: ["Projector off", "Whiteboard wiped", "Chairs in place"],
  },
];

// ── Demo users (backend.md §9) ──────────────────────────────────────────────

// login is the part before the @ and the role POST /auth/demo-login takes (architecture.md §6.1).
// department is an org unit code; badges are badge codes held as active grants; manages is the
// units this user manages, assigned through setOrgUnitManagers. emailHints stand in for what a
// roll-number address would give (architecture.md §8): a hint only, never used for access.
export const DEMO_USERS = [
  {
    login: "student",
    name: "Ananya Rao",
    roles: ["member"],
    memberType: "ug",
    department: "cse",
    emailHints: { year: 2024, level: "ug", branch: "cs" },
    verification: "approved",
    badges: ["electronics-lab-safety"], // and not 3D Printing Basics: the golden path requests it
    manages: [],
  },
  {
    login: "student2",
    name: "Kabir Singh",
    roles: ["member"],
    memberType: "ug",
    department: "mech",
    emailHints: { year: 2023, level: "ug", branch: "me" },
    verification: "approved",
    badges: ["3d-printing-basics"],
    manages: [],
  },
  {
    login: "faculty",
    name: "Dr. Kavya Nair",
    roles: ["member"],
    memberType: "faculty",
    department: "ece",
    verification: "approved",
    badges: [],
    manages: [],
  },
  {
    login: "manager",
    name: "Meera Iyer",
    roles: ["member", "manager"],
    memberType: "faculty",
    department: "mech",
    verification: "approved",
    badges: [],
    manages: ["dic", "cw"],
  },
  {
    login: "admin",
    name: "Campus Admin",
    roles: ["member", "admin"],
    memberType: "staff",
    verification: "approved",
    badges: [],
    manages: [],
  },
  {
    login: "newstudent",
    name: "Rohan Mehta",
    roles: ["member"],
    memberType: "ug",
    department: "ee",
    emailHints: { year: 2026, level: "ug", branch: "ee" },
    verification: "pending",
    badges: [],
    manages: [],
  },
];
