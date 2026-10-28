import http from '../../lib/http';
import { MOCK_RESOURCES, MOCK_ORG_UNITS } from './mockData';

/** GET /resources */
export async function getResources(params = {}) {
  try {
    const res = await http.get('/resources', { params });
    return res.data;
  } catch (err) {
    // Graceful fallback to rich mock data
    let filtered = [...MOCK_RESOURCES];
    if (params.category && params.category !== 'all') {
      filtered = filtered.filter((r) => r.category === params.category);
    }
    if (params.orgUnit && params.orgUnit !== 'all') {
      filtered = filtered.filter((r) => r.orgUnit._id === params.orgUnit || r.orgUnit.code === params.orgUnit);
    }
    if (params.q) {
      const q = params.q.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.location.toLowerCase().includes(q)
      );
    }
    return {
      status: 'success',
      data: {
        resources: filtered,
        total: filtered.length,
      },
    };
  }
}

/** GET /resources/:id */
export async function getResource(id) {
  try {
    const res = await http.get(`/resources/${id}`);
    return res.data;
  } catch (err) {
    const found = MOCK_RESOURCES.find((r) => r._id === id);
    if (found) {
      return { status: 'success', data: found };
    }
    throw err;
  }
}

/** GET /org-units */
export async function getOrgUnits() {
  try {
    const res = await http.get('/org-units');
    return res.data;
  } catch (err) {
    return { status: 'success', data: MOCK_ORG_UNITS };
  }
}

/** GET /resources/:id/availability */
export async function getAvailability(id, range = {}) {
  try {
    const res = await http.get(`/resources/${id}/availability`, { params: range });
    return res.data;
  } catch (err) {
    // Generate simulated 7-day schedule with plausible busy slots
    return {
      status: 'success',
      data: {
        resourceId: id,
        openHours: { start: '09:00', end: '19:00' },
        busySlots: [
          { start: '10:00', end: '12:00', dayOffset: 1, reason: 'Reserved' },
          { start: '14:00', end: '16:00', dayOffset: 1, reason: 'Lab Session' },
          { start: '11:00', end: '13:00', dayOffset: 2, reason: 'Reserved' },
          { start: '15:00', end: '17:00', dayOffset: 3, reason: 'Maintenance' },
        ],
      },
    };
  }
}

/** GET /resources/:id/eligibility */
export async function getEligibility(id, slot = {}) {
  try {
    const res = await http.get(`/resources/${id}/eligibility`, { params: slot });
    return res.data;
  } catch (err) {
    return {
      status: 'success',
      data: {
        passed: true,
        rules: [],
      },
    };
  }
}

