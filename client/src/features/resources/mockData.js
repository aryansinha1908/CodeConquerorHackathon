export const MOCK_ORG_UNITS = [
  { _id: 'org-dic', name: 'Design Innovation Centre (DIC)', code: 'DIC', location: 'Tech Hub Ground Floor' },
  { _id: 'org-ws', name: 'Central Workshop', code: 'WS', location: 'North Campus Shed 4' },
  { _id: 'org-cse', name: 'CSE Advanced Computing Lab', code: 'CSE', location: 'Computer Centre 2nd Floor' },
  { _id: 'org-ece', name: 'Electronics & VLSI Lab', code: 'ECE', location: 'ECE Department Block B' },
  { _id: 'org-mme', name: 'Materials Characterisation Lab', code: 'MME', location: 'Metallurgy Building' },
];

export const MOCK_RESOURCES = [
  {
    _id: 'res-3d-printer-2',
    title: 'FDM 3D Printer #2 (Creality Ender 5 Plus)',
    category: '3d_printer',
    categoryLabel: '3D Printer',
    orgUnit: MOCK_ORG_UNITS[0],
    location: 'Design Innovation Centre · Room 102',
    description: 'Large-format dual-Z FDM 3D printer for rapid prototyping. Build volume: 350 x 350 x 400 mm. Supports PLA, PETG, and TPU.',
    riskLevel: 'low',
    approvalMode: 'manual',
    quantity: 1,
    slotMinutes: 60,
    limits: {
      minDurationMinutes: 60,
      maxDurationMinutes: 240, // 4 hours
      maxHoursPerWeek: 6,
    },
    eligibility: {
      memberTypes: ['UG', 'PG', 'RS', 'FACULTY'],
      departments: [], // open to all
      requiredBadges: [
        { _id: 'badge-3d-basics', name: '3D Printing Basics', code: '3D_PRINT_101', unit: 'DIC' },
      ],
    },
    checklist: [
      'Clean glass bed before and after print with 99% IPA',
      'Inspect nozzle for clogs or filament burns',
      'Verify Z-offset and levelling probe clearance',
      'Photograph first-layer and final completed print',
    ],
    status: 'active',
  },
  {
    _id: 'res-a100-gpu-1',
    title: 'NVIDIA A100 Tensor Core GPU Node #1',
    category: 'computing',
    categoryLabel: 'Computing & AI',
    orgUnit: MOCK_ORG_UNITS[2],
    location: 'Computer Centre · Server Rack B4',
    description: 'High-performance 80GB SXM4 node for deep learning, transformer fine-tuning, and large-scale simulations with PyTorch/TensorFlow.',
    riskLevel: 'medium',
    approvalMode: 'auto',
    quantity: 1,
    slotMinutes: 60,
    limits: {
      minDurationMinutes: 120,
      maxDurationMinutes: 360, // 6 hours
      maxHoursPerWeek: 12,
    },
    eligibility: {
      memberTypes: ['UG', 'PG', 'RS', 'FACULTY'],
      departments: ['CSE', 'ECE', 'EE'],
      requiredBadges: [
        { _id: 'badge-slurm-hpc', name: 'HPC & Slurm Cluster Access', code: 'HPC_201', unit: 'CSE' },
      ],
    },
    checklist: [
      'Kill background daemon threads on teardown',
      'Verify clean GPU memory deallocation with nvidia-smi',
      'Backup checkpoint tensors to external scratch storage',
    ],
    status: 'active',
  },
  {
    _id: 'res-laser-cutter-60w',
    title: '60W CO2 Precision Laser Cutter & Engraver',
    category: 'workshop',
    categoryLabel: 'Workshop & Fabrication',
    orgUnit: MOCK_ORG_UNITS[0],
    location: 'Design Innovation Centre · Fabrication Bay',
    description: 'High-precision laser cutter for acrylic, balsa wood, MDF, and cardboard. Ruida digital DSP controller with safety fume extraction.',
    riskLevel: 'high',
    approvalMode: 'manual',
    quantity: 1,
    slotMinutes: 30,
    limits: {
      minDurationMinutes: 30,
      maxDurationMinutes: 180, // 3 hours
      maxHoursPerWeek: 4,
    },
    eligibility: {
      memberTypes: ['UG', 'PG', 'RS', 'FACULTY'],
      departments: [],
      requiredBadges: [
        { _id: 'badge-laser-safety', name: 'Laser Safety Level 1', code: 'LASER_01', unit: 'DIC' },
      ],
    },
    checklist: [
      'Confirm fume exhaust blower and air assist compressor are ON',
      'Clean laser focus lens and mirrors',
      'Check honeycomb bed for combustible debris',
      'Wear OD5+ laser safety goggles at all times during operation',
    ],
    status: 'active',
  },
  {
    _id: 'res-tensile-utm',
    title: 'Instron Universal Tensile Testing Machine (50kN)',
    category: 'testing',
    categoryLabel: 'Testing & Materials',
    orgUnit: MOCK_ORG_UNITS[1],
    location: 'Central Workshop · Materials Testing Lab',
    description: 'Electromechanical testing system for tensile, compression, flexure, and shear evaluations with Bluehill Universal digital capture.',
    riskLevel: 'high',
    approvalMode: 'manual',
    quantity: 1,
    slotMinutes: 60,
    limits: {
      minDurationMinutes: 60,
      maxDurationMinutes: 120, // 2 hours
      maxHoursPerWeek: 4,
    },
    eligibility: {
      memberTypes: ['PG', 'RS', 'FACULTY'],
      departments: ['ME', 'MME', 'CE', 'PIE'],
      requiredBadges: [
        { _id: 'badge-utm-safety', name: 'Heavy Machinery & UTM Certification', code: 'UTM_301', unit: 'WS' },
      ],
    },
    checklist: [
      'Calibrate load cell zero before specimen insertion',
      'Ensure safety enclosure shields are latched shut',
      'Collect test fracture debris and clean wedge grips',
    ],
    status: 'active',
  },
  {
    _id: 'res-oscilloscope-station',
    title: 'Rigol 4-Channel 100MHz Digital Oscilloscope & SMD Soldering',
    category: 'electronics',
    categoryLabel: 'Electronics Lab',
    orgUnit: MOCK_ORG_UNITS[3],
    location: 'ECE Department · Hardware Bench 7',
    description: 'Benchtop test station equipped with Rigol DS1104Z-S Plus oscilloscope, arbitrary waveform generator, DC dual power supply, and Hakko iron.',
    riskLevel: 'low',
    approvalMode: 'auto',
    quantity: 2,
    slotMinutes: 30,
    limits: {
      minDurationMinutes: 30,
      maxDurationMinutes: 240, // 4 hours
      maxHoursPerWeek: 8,
    },
    eligibility: {
      memberTypes: ['UG', 'PG', 'RS', 'FACULTY'],
      departments: ['ECE', 'EE', 'CSE'],
      requiredBadges: [],
    },
    checklist: [
      'Turn off solder station and wipe hot tip on brass sponge',
      'Switch off DC bench supply outputs',
      'Coil BNC probes without sharp pinching',
    ],
    status: 'active',
  },
  {
    _id: 'res-cnc-mill',
    title: 'Haas 3-Axis CNC Vertical Machining Center',
    category: 'workshop',
    categoryLabel: 'Workshop & Fabrication',
    orgUnit: MOCK_ORG_UNITS[1],
    location: 'Central Workshop · CNC Section',
    description: 'High-torque industrial CNC milling station for aluminium, brass, and engineering polymers. Automated 20-station tool carousel.',
    riskLevel: 'high',
    approvalMode: 'manual',
    quantity: 1,
    slotMinutes: 60,
    limits: {
      minDurationMinutes: 60,
      maxDurationMinutes: 240,
      maxHoursPerWeek: 6,
    },
    eligibility: {
      memberTypes: ['UG', 'PG', 'RS', 'FACULTY'],
      departments: ['ME', 'PIE'],
      requiredBadges: [
        { _id: 'badge-cnc-operator', name: 'CNC Operator Level 2', code: 'CNC_202', unit: 'WS' },
      ],
    },
    checklist: [
      'Verify G-code simulation dry-run with no tool clash',
      'Flush swarf chips into recovery bin',
      'Check spindle coolant reservoir levels',
    ],
    status: 'active',
  },
];

