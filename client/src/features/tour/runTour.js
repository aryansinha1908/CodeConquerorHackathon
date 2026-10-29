// Runs a tour from tours.js with driver.js, loaded on first use so no page pays for it up front.
// Steps whose target isn't on the page are dropped. One tour at a time: stopTour() ends the running one,
// and TourButton calls it whenever the route changes, so a link clicked mid-tour never leaves the next
// page under the tour's overlay. When the tour ends, focus goes back to whatever opened it.

let active = null;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// driver.js renders the title and text as HTML. The tour's strings are our own literals, but escape
// them anyway, so a resource title or other data put in a step later can't inject markup.
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const selectorOf = (target) => `[data-tour="${target}"]`;

/**
 * The steps that can be shown now, as driver.js steps. A step's element is its selector, not the node,
 * so a node that re-renders between steps is found again. `exists` is injectable for the tests.
 */
export function presentSteps(tour, exists = (target) => Boolean(document.querySelector(selectorOf(target)))) {
  return tour.steps
    .filter((step) => !step.target || exists(step.target))
    .map((step) => ({
      ...(step.target && { element: selectorOf(step.target) }),
      popover: { title: escapeHtml(step.title), description: escapeHtml(step.text) },
    }));
}

/** Ends the running tour, if any. */
export function stopTour() {
  const running = active;
  active = null;
  running?.destroy();
}

export async function runTour(tour) {
  const steps = presentSteps(tour);
  if (!steps.length) return false;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const [{ driver }] = await Promise.all([import('driver.js'), import('driver.js/dist/driver.css')]);
  stopTour();
  const reduced = prefersReducedMotion();
  const tourDriver = driver({
    steps,
    showProgress: steps.length > 1,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    animate: !reduced,
    smoothScroll: !reduced,
    allowClose: true,
    popoverClass: 'cc-tour',
    stagePadding: 6,
    stageRadius: 10,
    onDestroyed: () => {
      if (active === tourDriver) active = null;
      // driver.js returns focus to the last step's button, which is gone by now.
      if (opener?.isConnected) opener.focus();
    },
  });
  active = tourDriver;
  tourDriver.drive();
  return true;
}
