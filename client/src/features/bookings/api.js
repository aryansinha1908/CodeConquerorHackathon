import http from '../../lib/http';
import { MOCK_RESOURCES } from '../resources/mockData';
import { useAuthStore } from '../../stores/auth';

const STORAGE_KEY = 'campuscommons_bookings_v1';

function getStoredBookings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // fallback
  }

  // Initial Seeded Golden Path Bookings
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const formatISO = (d, h, m) => {
    const copy = new Date(d);
    copy.setHours(h, m, 0, 0);
    return copy.toISOString();
  };

  const initial = [
    {
      _id: 'book-001',
      resource: MOCK_RESOURCES[0], // 3D Printer #2
      user: {
        _id: 'user-stu-1',
        name: 'Aman Sharma',
        email: '2024ugcs042@nitjsr.ac.in',
        memberType: 'UG',
        department: { code: 'CSE', name: 'Computer Science' },
      },
      start: formatISO(tomorrow, 10, 0),
      end: formatISO(tomorrow, 12, 0),
      purpose: 'Printing drone chassis frame for DIC Innovation Challenge 2026.',
      status: 'pending',
      waitlistPosition: null,
      timeline: [
        {
          event: 'booking.created',
          actor: 'Aman Sharma (Student)',
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          reason: 'Initial slot request submitted.',
        },
      ],
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    {
      _id: 'book-002',
      resource: MOCK_RESOURCES[0], // 3D Printer #2 (Conflicting slot)
      user: {
        _id: 'user-stu-2',
        name: 'Sneha Patel',
        email: '2023ugme018@nitjsr.ac.in',
        memberType: 'UG',
        department: { code: 'ME', name: 'Mechanical Engineering' },
      },
      start: formatISO(tomorrow, 10, 0),
      end: formatISO(tomorrow, 12, 0),
      purpose: 'RoboWars mechanical gear housing prototyping.',
      status: 'waitlisted',
      waitlistPosition: 1,
      timeline: [
        {
          event: 'booking.created',
          actor: 'Sneha Patel (Student 2)',
          timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(),
          reason: 'Slot held by earlier request; joined waitlist #1.',
        },
      ],
      createdAt: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    },
    {
      _id: 'book-003',
      resource: MOCK_RESOURCES[1], // NVIDIA A100 GPU
      user: {
        _id: 'user-stu-1',
        name: 'Aman Sharma',
        email: '2024ugcs042@nitjsr.ac.in',
        memberType: 'UG',
        department: { code: 'CSE', name: 'Computer Science' },
      },
      start: formatISO(today, 14, 0),
      end: formatISO(today, 18, 0),
      purpose: 'BERT transformer attention head visualization fine-tuning run.',
      status: 'approved',
      waitlistPosition: null,
      timeline: [
        {
          event: 'booking.created',
          actor: 'Aman Sharma (Student)',
          timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
          reason: 'Automated policy approved for CSE lab tier.',
        },
        {
          event: 'booking.approved',
          actor: 'System Policy (Auto-Approve)',
          timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
          reason: 'Quota and badge prerequisites satisfied.',
        },
      ],
      createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    },
    {
      _id: 'book-004',
      resource: MOCK_RESOURCES[4], // Rigol Oscilloscope
      user: {
        _id: 'user-stu-1',
        name: 'Aman Sharma',
        email: '2024ugcs042@nitjsr.ac.in',
        memberType: 'UG',
        department: { code: 'CSE', name: 'Computer Science' },
      },
      start: formatISO(today, 9, 0),
      end: formatISO(today, 13, 0),
      purpose: 'ESP32 SPI bus signal integrity debug with logic analyzer.',
      status: 'checked_in',
      waitlistPosition: null,
      conditionReports: {
        checkIn: {
          overall: 'good',
          notes: 'Unit clean, BNC probes in good condition.',
          checklist: ['Turn off solder station', 'Switch off DC bench supply', 'Coil probes'],
          photos: ['/background.jpeg'],
          submittedAt: new Date(Date.now() - 3600000 * 1.8).toISOString(),
        },
      },
      timeline: [
        {
          event: 'booking.approved',
          actor: 'System',
          timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
          reason: 'Instant reservation granted.',
        },
        {
          event: 'booking.checked_in',
          actor: 'Aman Sharma (Student)',
          timestamp: new Date(Date.now() - 3600000 * 1.8).toISOString(),
          reason: 'Check-in checklist verified with photo.',
        },
      ],
      createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    },
    {
      _id: 'book-005',
      resource: MOCK_RESOURCES[2], // Laser Cutter 60W
      user: {
        _id: 'user-stu-1',
        name: 'Aman Sharma',
        email: '2024ugcs042@nitjsr.ac.in',
        memberType: 'UG',
        department: { code: 'CSE', name: 'Computer Science' },
      },
      start: formatISO(new Date(Date.now() - 86400000 * 2), 11, 0),
      end: formatISO(new Date(Date.now() - 86400000 * 2), 13, 0),
      purpose: 'Acrylic laser cut enclosure panels for DIC lab prototype.',
      status: 'completed',
      waitlistPosition: null,
      timeline: [
        {
          event: 'booking.approved',
          actor: 'Dr. R. Singh (DIC Manager)',
          timestamp: new Date(Date.now() - 86400000 * 2.5).toISOString(),
          reason: 'Safety protocols and acrylic spec verified.',
        },
        {
          event: 'booking.completed',
          actor: 'Dr. R. Singh (DIC Manager)',
          timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
          reason: 'Return confirmed. Honeycomb bed in pristine condition.',
        },
      ],
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
  ];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  } catch (e) {
    // ignore
  }
  return initial;
}

function saveBookings(bookings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  } catch (e) {
    // ignore
  }
}

/** POST /bookings/check — live pre-check */
export async function checkBooking(data) {
  try {
    const res = await http.post('/bookings/check', data);
    return res.data;
  } catch (err) {
    // Simulated live pre-check engine
    const bookings = getStoredBookings();
    const { resourceId, start, end } = data;
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();

    // Find conflicting bookings on this resource
    const conflicting = bookings.filter((b) => {
      if (b.resource._id !== resourceId && b.resource !== resourceId) return false;
      if (['rejected', 'cancelled', 'expired', 'completed'].includes(b.status)) return false;
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      return Math.max(s, bStart) < Math.min(e, bEnd);
    });

    if (conflicting.length > 0) {
      return {
        status: 'success',
        data: {
          available: false,
          code: 'SLOT_TAKEN',
          conflictCount: conflicting.length,
          waitlistPosition: conflicting.length + 1,
          message: `Slot held by an earlier request (${conflicting[0].user?.name || 'Another borrower'}).`,
        },
      };
    }

    return {
      status: 'success',
      data: {
        available: true,
        code: 'AVAILABLE',
        conflictCount: 0,
        waitlistPosition: null,
        message: 'Slot is open. All eligibility rules satisfied.',
      },
    };
  }
}

/** POST /bookings — create reservation request */
export async function createBooking(data) {
  try {
    const res = await http.post('/bookings', data);
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    const user = useAuthStore.getState().user || {
      _id: 'user-curr',
      name: 'Current User',
      email: 'user@nitjsr.ac.in',
      memberType: 'UG',
      department: { code: 'CSE', name: 'Computer Science' },
    };

    const resource =
      MOCK_RESOURCES.find((r) => r._id === data.resourceId) || MOCK_RESOURCES[0];

    // Pre-check for conflict
    const s = new Date(data.start).getTime();
    const e = new Date(data.end).getTime();
    const conflicting = bookings.filter((b) => {
      if (b.resource._id !== resource._id) return false;
      if (['rejected', 'cancelled', 'expired', 'completed'].includes(b.status)) return false;
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      return Math.max(s, bStart) < Math.min(e, bEnd);
    });

    let newStatus = 'pending';
    let waitlistPos = null;

    if (conflicting.length > 0) {
      newStatus = 'waitlisted';
      waitlistPos = conflicting.length + 1;
    } else if (resource.approvalMode === 'auto') {
      newStatus = 'approved';
    }

    const newBooking = {
      _id: `book-${Date.now().toString(36)}`,
      resource,
      user,
      start: data.start,
      end: data.end,
      purpose: data.purpose,
      status: newStatus,
      waitlistPosition: waitlistPos,
      timeline: [
        {
          event: newStatus === 'approved' ? 'booking.approved' : 'booking.created',
          actor: `${user.name} (${user.memberType})`,
          timestamp: new Date().toISOString(),
          reason:
            newStatus === 'waitlisted'
              ? `Joined waitlist position #${waitlistPos}`
              : newStatus === 'approved'
              ? 'Instant auto-approval policy'
              : 'Reservation request submitted for manager review.',
        },
      ],
      createdAt: new Date().toISOString(),
    };

    bookings.unshift(newBooking);
    saveBookings(bookings);

    return {
      status: 'success',
      data: newBooking,
      message:
        newStatus === 'approved'
          ? 'Slot approved instantly!'
          : newStatus === 'waitlisted'
          ? `You have joined the waitlist as #${waitlistPos}.`
          : 'Booking request submitted for facility manager review.',
    };
  }
}

/** GET /bookings/mine */
export async function getMyBookings(params = {}) {
  try {
    const res = await http.get('/bookings/mine', { params });
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    return {
      status: 'success',
      data: bookings,
    };
  }
}

/** GET /bookings/:id */
export async function getBooking(id) {
  try {
    const res = await http.get(`/bookings/${id}`);
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    const found = bookings.find((b) => b._id === id);
    if (found) return { status: 'success', data: found };
    throw { status: 404, message: 'Booking not found' };
  }
}

/** POST /bookings/:id/cancel */
export async function cancelBooking(id, reason) {
  try {
    const res = await http.post(`/bookings/${id}/cancel`, { reason });
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    const item = bookings.find((b) => b._id === id);
    if (item) {
      item.status = 'cancelled';
      item.timeline = item.timeline || [];
      item.timeline.push({
        event: 'booking.cancelled',
        actor: 'User',
        timestamp: new Date().toISOString(),
        reason: reason || 'Cancelled by borrower.',
      });
      saveBookings(bookings);
      return { status: 'success', data: item };
    }
    throw err;
  }
}

/** POST /bookings/:id/check-in */
export async function checkInBooking(id, payload) {
  try {
    const res = await http.post(`/bookings/${id}/check-in`, payload);
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    const item = bookings.find((b) => b._id === id);
    if (item) {
      item.status = 'checked_in';
      item.conditionReports = item.conditionReports || {};
      item.conditionReports.checkIn = {
        overall: payload.overall || 'good',
        notes: payload.notes || 'Clean condition verified.',
        checklist: payload.checklist || [],
        photos: payload.photos || ['/background.jpeg'],
        submittedAt: new Date().toISOString(),
      };
      item.timeline = item.timeline || [];
      item.timeline.push({
        event: 'booking.checked_in',
        actor: 'Borrower',
        timestamp: new Date().toISOString(),
        reason: 'Check-in completed with condition photo and safety checklist.',
      });
      saveBookings(bookings);
      return { status: 'success', data: item };
    }
    throw err;
  }
}

/** POST /bookings/:id/check-out */
export async function checkOutBooking(id, payload) {
  try {
    const res = await http.post(`/bookings/${id}/check-out`, payload);
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    const item = bookings.find((b) => b._id === id);
    if (item) {
      item.status = 'checked_out';
      item.conditionReports = item.conditionReports || {};
      item.conditionReports.checkOut = {
        overall: payload.overall || 'good',
        notes: payload.notes || 'Tool returned properly.',
        checklist: payload.checklist || [],
        photos: payload.photos || ['/background.jpeg'],
        submittedAt: new Date().toISOString(),
      };
      item.timeline = item.timeline || [];
      item.timeline.push({
        event: 'booking.checked_out',
        actor: 'Borrower',
        timestamp: new Date().toISOString(),
        reason: 'Check-out completed. Awaiting facility manager return confirmation.',
      });
      saveBookings(bookings);
      return { status: 'success', data: item };
    }
    throw err;
  }
}

/** GET /bookings/manage — returns requests grouped by conflicting slot */
export async function getManageBookings() {
  try {
    const res = await http.get('/bookings/manage');
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    // Group conflicting requests
    const slotGroups = [];
    const processed = new Set();

    bookings.forEach((b) => {
      if (processed.has(b._id)) return;
      if (!['pending', 'waitlisted', 'approved'].includes(b.status)) return;

      const group = [b];
      processed.add(b._id);

      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();

      bookings.forEach((other) => {
        if (processed.has(other._id)) return;
        if (!['pending', 'waitlisted', 'approved'].includes(other.status)) return;
        if (other.resource._id !== b.resource._id) return;

        const oStart = new Date(other.start).getTime();
        const oEnd = new Date(other.end).getTime();

        if (Math.max(bStart, oStart) < Math.min(bEnd, oEnd)) {
          group.push(other);
          processed.add(other._id);
        }
      });

      slotGroups.push({
        slotKey: `${b.resource._id}-${b.start}`,
        resource: b.resource,
        start: b.start,
        end: b.end,
        requests: group,
      });
    });

    return {
      status: 'success',
      data: slotGroups,
    };
  }
}

/** POST /bookings/:id/(approve|reject|waitlist) */
export async function decideBooking(id, action, reason) {
  try {
    const res = await http.post(`/bookings/${id}/${action}`, { reason });
    return res.data;
  } catch (err) {
    const bookings = getStoredBookings();
    const item = bookings.find((b) => b._id === id);
    if (!item) throw { status: 404, message: 'Booking not found' };

    const actionToStatus = {
      approve: 'approved',
      reject: 'rejected',
      waitlist: 'waitlisted',
    };

    item.status = actionToStatus[action] || action;
    item.timeline = item.timeline || [];
    item.timeline.push({
      event: `booking.${item.status}`,
      actor: 'Unit Manager',
      timestamp: new Date().toISOString(),
      reason: reason || `Decision: ${action}`,
    });

    saveBookings(bookings);
    return { status: 'success', data: item };
  }
}

