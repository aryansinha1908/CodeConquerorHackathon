// Shared framer-motion presets, so every animation in the app moves the same way. Opacity and
// transform only (no layout-affecting properties), and short: 150–250 ms. App.jsx sets
// <MotionConfig reducedMotion="user">, so with the OS's reduce-motion setting on, the transforms are
// skipped and only the fades run.

const EASE_OUT = [0.22, 1, 0.36, 1];

/** A short rise and fade in: pages, cards, sections. */
export const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } },
};

/** Just a fade, for things that must not move (text that takes focus, sticky regions). */
export const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } },
};

/** A parent that brings its children in one after another (each child uses fadeUp or fadeIn). */
export function stagger(step = 0.05, delay = 0) {
  return {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren: delay } },
  };
}

/** Props for an element that enters with a variant set: spread them onto a motion element. */
export const enter = { initial: 'hidden', animate: 'show' };

/**
 * Cards and tiles: lift towards the pointer, matching the app's offset shadows. Hover only: a
 * whileTap on an element that isn't a button, link or form field makes framer's press gesture give
 * it tabIndex=0, an extra tab stop that does nothing on Enter.
 */
export const hoverLift = {
  whileHover: { y: -4, transition: { duration: 0.15, ease: 'easeOut' } },
};

/** Buttons and pills (real <button>s only, for the reason above): a small press. */
export const press = {
  whileTap: { scale: 0.96 },
};

/** Dropdown panels: grow from the top right, where their buttons are. */
export const menuIn = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.16, ease: EASE_OUT } },
  style: { transformOrigin: 'top right' },
};

/** Dialog panels: a slight zoom in. */
export const dialogIn = {
  initial: { opacity: 0, scale: 0.97, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } },
};

/** The spring the sliding indicators (layoutId) and count badges use. */
export const spring = { type: 'spring', stiffness: 500, damping: 38 };
