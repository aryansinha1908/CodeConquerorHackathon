// The success half of the response envelope (architecture.md §6), the twin of sendError() in
// middleware/errorHandler.js:
//   { success: true, data, meta?, requestId }
// List services return { items, meta }; controllers send them as sendData(req, res, items, { meta }).
export function sendData(req, res, data, { status = 200, meta } = {}) {
  return res.status(status).json({
    success: true,
    data: data ?? null,
    ...(meta !== undefined && { meta }),
    requestId: req.id,
  });
}

// For a service that returns { items, meta }: data is the items, meta goes beside it.
export const sendList = (req, res, { items, meta }) =>
  sendData(req, res, items, { meta });
